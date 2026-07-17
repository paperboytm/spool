// User-facing display-name override. The Google-claim name lives in
// users.name; this is what the user typed to replace it.
//
// Validation philosophy: be strict at the boundary, permissive in
// rendering. We reject:
//   - empty / whitespace-only
//   - longer than 50 grapheme clusters (so a 50-emoji name still fits)
//   - invisible / control codepoints that would either let a user
//     impersonate someone (zero-width characters next to a real
//     handle), break layout (line/paragraph separators inside a
//     single-line name), or carry a hidden payload (BOM, bidi marks)
// We DO allow:
//   - any printable Unicode (CJK, emoji, RTL scripts)
//   - leading/trailing whitespace, which we trim
//
// Why grapheme-based length: a single emoji glyph is several code
// units. Counting code units would let a 50-emoji name look "too long"
// in JS while looking normal to the user. Intl.Segmenter is supported
// in Cloudflare Workers' V8.

const MAX_GRAPHEMES = 50

export interface ValidDisplayName {
  ok: true
  /** Trimmed, control-stripped value safe to store. */
  value: string
}
export interface InvalidDisplayName {
  ok: false
  reason: 'empty' | 'too_long' | 'control_chars'
}
export type DisplayNameValidation = ValidDisplayName | InvalidDisplayName

// Build the control-block regex via RegExp + String.fromCharCode so
// the source file stays free of literal control chars (those tripped
// the TS/esbuild parser earlier). Blocks:
//   U+0000-U+001F  C0 control
//   U+007F-U+009F  DEL + C1 control
//   U+200B-U+200F  zero-width + bidi LTR/RTL marks
//   U+2028-U+202E  line/paragraph separators + bidi overrides
//   U+2060-U+206F  word joiner + invisible math operators
//   U+FEFF         BOM / zero-width no-break space
const CONTROL_RE = new RegExp(
  '[' +
    String.fromCharCode(0x0000) + '-' + String.fromCharCode(0x001f) +
    String.fromCharCode(0x007f) + '-' + String.fromCharCode(0x009f) +
    String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) +
    String.fromCharCode(0x2028) + '-' + String.fromCharCode(0x202e) +
    String.fromCharCode(0x2060) + '-' + String.fromCharCode(0x206f) +
    String.fromCharCode(0xfeff) +
    ']',
)

export function validateDisplayName(raw: string): DisplayNameValidation {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (CONTROL_RE.test(trimmed)) return { ok: false, reason: 'control_chars' }
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let count = 0
  for (const _ of segmenter.segment(trimmed)) {
    count++
    if (count > MAX_GRAPHEMES) return { ok: false, reason: 'too_long' }
  }
  return { ok: true, value: trimmed }
}

/** Render-time fall-through: user override → provider claim → email-derived. */
export function resolveDisplayName(user: {
  display_name: string | null
  name: string | null
  email: string
}): string {
  if (user.display_name && user.display_name.length > 0) return user.display_name
  if (user.name && user.name.length > 0) return user.name
  // Last resort: email local-part. Never expose this if we can help
  // it, but we'd rather render something legible than an empty bubble.
  return user.email.split('@')[0] ?? user.email
}
