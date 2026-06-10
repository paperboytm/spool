import { z } from 'zod'

export const Snapshot = z.object({
  schema_version: z.literal(1),
  source: z.object({
    kind: z.enum(['spool-session', 'imported-file', 'imported-jsonl']),
    origin_hint: z.string().optional(),
    captured_at: z.iso.datetime(),
  }),
  conversation: z
    .object({
      title: z.string().min(1).max(200),
      // Array bounds sized against real-world session-length data:
      // p99 ≈ 1,740 turns, max observed ≈ 4,565 turns on actual
      // power-user dbs. 20,000 = ~4× the largest real session — wide
      // enough that nobody legitimate hits it, narrow enough that
      // zod can't be coerced into iterating millions of array
      // entries before MAX_SNAPSHOT_BYTES (2MB) would have rejected
      // the payload upstream. The body cap is the real defense; this
      // is the sanity guard that prevents validator CPU bloat on a
      // crafted-array attack.
      turns: z
        .array(
          z.object({
            id: z.string(),
            role: z.enum(['user', 'assistant', 'system', 'tool']),
            content: z.string().max(200_000),
            redacted: z.boolean().optional(),
          }),
        )
        .max(20_000),
      turn_order: z.array(z.string()).max(20_000),
      // hidden_turns can never legitimately exceed turns.length (the
      // refine below enforces every id is real). Same 20k cap so a
      // crafted payload can't sit between "body fits in 2MB" and
      // "refine catches it" pumping validator memory.
      hidden_turns: z.array(z.string()).max(20_000),
    })
    // Reader assumes turn_order indexes every turn exactly once and that
    // hidden_turns references known turn ids. Without these checks a
    // malformed snapshot would render an empty / partial reader page
    // with no clear error.
    .refine((c) => c.turn_order.length === c.turns.length, {
      message: 'turn_order length must match turns length',
      path: ['turn_order'],
    })
    .refine(
      (c) => {
        const ids = new Set(c.turns.map((t) => t.id))
        return (
          c.turn_order.every((id) => ids.has(id)) &&
          c.hidden_turns.every((id) => ids.has(id))
        )
      },
      {
        message: 'turn_order/hidden_turns reference an unknown turn id',
        path: ['turn_order'],
      },
    ),
  // editor_opts.template/paper/typeface/colorway are intentionally
  // z.string() (not enums): share-kit ships built-in values but also
  // allows custom ones; the server is the wrong place to gate that.
  editor_opts: z.object({
    template: z.string(),
    paper: z.string(),
    typeface: z.string(),
    colorway: z.string(),
    density: z.enum(['compact', 'relaxed']),
    masthead: z.boolean(),
    colophon: z.boolean(),
    avatars: z.boolean(),
    show_byline: z.boolean(),
  }),
})

export const PublishRequest = z.object({
  snapshot: Snapshot,
  visibility: z.enum(['unlisted', 'profile-listed']),
  // Renderer's local share_drafts.draft_id. Persisted on the share row
  // so the editor can later look up "is this draft published?" without
  // title heuristics. nanoid(21) is the format the renderer emits, but
  // the server stays format-agnostic and only bounds the length so a
  // pathological client can't bloat the column.
  draft_id: z.string().min(1).max(128),
  // Idempotency token for at-most-once publish on retry. The renderer
  // derives it deterministically from the request payload (snapshot +
  // visibility), so retries of the same intent re-use the same token
  // and the backend short-circuits to the prior result; a re-edited
  // intent generates a fresh token and creates a new share.
  // 64-char sha256 hex is the canonical value; we bound generously to
  // accommodate future hash bumps without a schema change.
  // NOTE: `expires_at` was removed with the expiry feature. z.object
  // strips unknown keys, so an older client still sending it simply
  // gets a permanent share instead of a 422.
  idempotency_key: z.string().min(8).max(256),
  // Mirror `isValidSlug` (slug.ts): 21 chars, URL-safe alphabet. The
  // handler re-runs `isValidSlug()` after this, but enforcing at the
  // schema boundary lets us reject malformed slugs before any DB
  // round-trips fire (idempotency SELECT, ownership SELECT).
  override_slug: z.string().regex(/^[\w-]{21}$/).optional(),
})

export type PublishRequestT = z.infer<typeof PublishRequest>
export type SnapshotT = z.infer<typeof Snapshot>
