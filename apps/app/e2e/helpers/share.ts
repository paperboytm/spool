import { expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FIXTURES_DIR = join(__dirname, '..', 'fixtures')

/**
 * Click into a session by sessionUuid (drilling down through the first
 * project row that contains it), then trigger Share from the SessionDetail
 * header. Leaves the share editor open. Caller is responsible for
 * `expectShareEditorVisible` if it wants to await readiness.
 */
export async function openShareEditorFromSessionDetail(window: Page, sessionUuid: string): Promise<void> {
  await openSessionDetail(window, sessionUuid)
  await window.locator('[data-testid="detail-share"]').click()
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeVisible({ timeout: 5000 })
}

/**
 * Open a session by sessionUuid via the first project row containing it.
 * Does not open the share editor — useful for entry-point tests that want
 * to verify the ⋯ menu Share item.
 */
export async function openSessionDetail(window: Page, sessionUuid: string): Promise<void> {
  // First make sure a project is selected and SessionRow is in the list.
  // We don't know which project hosts the session ahead of time, so we
  // click each project row and look. For fixtures all sessions are under
  // the single test-project, so the first project row works.
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const row = window.locator(`[data-testid="session-row"][data-session-uuid="${sessionUuid}"]`)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  await expect(window.locator(`[data-testid="session-detail"]`)).toBeVisible({ timeout: 5000 })
}

/**
 * Open a SessionRow ⋯ menu and pick "Edit share draft".
 */
export async function shareFromSessionRowMenu(window: Page, sessionUuid: string): Promise<void> {
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const row = window.locator(`[data-testid="session-row"][data-session-uuid="${sessionUuid}"]`)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.hover()
  await row.getByLabel('More actions').click()
  await window.getByRole('menuitem', { name: 'Edit share draft' }).click()
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeVisible({ timeout: 5000 })
}

/** Navigate the sidebar to the Shares page. */
export async function navigateToShares(window: Page): Promise<void> {
  await window.locator('[data-testid="sidebar-shares"]').click()
  // SharesPage is mounted in App when isSharesView is true; we wait for
  // either the empty state CTA or the drafts grid to render.
  await expect(
    window.locator('[data-testid="shares-empty-start"], [data-testid="shares-draft-row"]').first(),
  ).toBeVisible({ timeout: 5000 })
}

/**
 * Replace `window.showSaveFilePicker` with a stub that captures the bytes
 * written through createWritable().write() into a global array
 * `__spoolE2EWrites`. Tests can then read that array after triggering an
 * export to inspect the produced blob.
 */
export async function installSaveFilePickerMock(window: Page): Promise<void> {
  await window.evaluate(() => {
    interface CapturedWrite {
      filename: string
      bytes: number[]
    }
    const winAny = window as unknown as {
      __spoolE2EWrites: CapturedWrite[]
      showSaveFilePicker?: unknown
    }
    winAny.__spoolE2EWrites = []
    const fakePicker = (opts: { suggestedName: string }) => {
      const filename = opts.suggestedName
      const chunks: Uint8Array[] = []
      const writable = {
        write: async (chunk: Blob | ArrayBuffer | Uint8Array | string) => {
          let bytes: Uint8Array
          if (chunk instanceof Blob) {
            bytes = new Uint8Array(await chunk.arrayBuffer())
          } else if (chunk instanceof Uint8Array) {
            bytes = chunk
          } else if (chunk instanceof ArrayBuffer) {
            bytes = new Uint8Array(chunk)
          } else {
            bytes = new TextEncoder().encode(String(chunk))
          }
          chunks.push(bytes)
        },
        close: async () => {
          const total = chunks.reduce((n, c) => n + c.length, 0)
          const merged = new Uint8Array(total)
          let off = 0
          for (const c of chunks) {
            merged.set(c, off)
            off += c.length
          }
          winAny.__spoolE2EWrites.push({ filename, bytes: Array.from(merged) })
        },
      }
      const handle = {
        kind: 'file' as const,
        name: filename,
        createWritable: async () => writable,
      }
      return Promise.resolve(handle)
    }
    winAny.showSaveFilePicker = fakePicker
  })
}

/** Pop the most recent write captured by `installSaveFilePickerMock`. */
export async function readLastSavedFile(window: Page): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const result = await window.evaluate(() => {
    const winAny = window as unknown as {
      __spoolE2EWrites?: { filename: string; bytes: number[] }[]
    }
    const arr = winAny.__spoolE2EWrites ?? []
    return arr[arr.length - 1] ?? null
  })
  if (!result) return null
  return { filename: result.filename, bytes: new Uint8Array(result.bytes) }
}

/**
 * Wait until a write with `expectedExt` extension has been captured.
 * Polls because writeToSlot.close() is async after the click returns.
 */
export async function waitForSavedFile(
  window: Page,
  expectedExt: string,
  timeoutMs = 5000,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const last = await readLastSavedFile(window)
    if (last && last.filename.endsWith(expectedExt)) return last
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Timed out waiting for ${expectedExt} save`)
}

/**
 * Seed a share_drafts row via the renderer's IPC bridge. Returns the
 * generated draft_id so the test can reference it later. The conversation
 * + opts fields default to a minimal Conversation + DEFAULT_OPTS-ish
 * shape; tests can override either.
 */
export async function seedShareDraft(
  window: Page,
  overrides: {
    title?: string
    sourceKind?: 'spool-session' | 'pasted-url' | 'imported-file' | 'imported-jsonl'
    sourceOrigin?: string | null
    conversation?: Record<string, unknown>
    opts?: Record<string, unknown>
  } = {},
): Promise<string> {
  return window.evaluate(async (payload) => {
    const draftId = `e2e-draft-${Math.random().toString(36).slice(2, 10)}`
    const convo = payload.conversation ?? {
      source: 'claude',
      sourceLabel: 'Claude',
      origin: { kind: 'web-share', platform: 'Claude' },
      title: payload.title ?? 'Seeded draft',
      shareUrl: null,
      createdAt: new Date().toISOString(),
      wordCount: 4,
      readMin: 1,
      turns: [
        { role: 'user', body: 'hello' },
        { role: 'assistant', body: 'hi there' },
      ],
    }
    const opts = payload.opts ?? {
      template: 'chat',
      paper: 'snow',
      typeface: 'inter',
      colorway: 'amber',
      accentHex: '#C85A00',
      density: 'compact',
      redact: true,
      showGaps: true,
      showMasthead: true,
      showColophon: true,
      hideEmptyTurns: true,
    }
    const doc = { version: 1, conversation: convo, opts, exportedAt: new Date().toISOString() }
    const preview = { ...doc, conversation: { ...convo, turns: (convo.turns as unknown[]).slice(0, 6) } }
    await (window as unknown as {
      spool: { shareDraft: { upsert: (input: unknown) => Promise<unknown> } }
    }).spool.shareDraft.upsert({
      draft_id: draftId,
      source_kind: payload.sourceKind ?? 'spool-session',
      source_origin: payload.sourceOrigin ?? null,
      title: payload.title ?? (convo as { title: string }).title,
      snapshot_json: JSON.stringify(doc),
      preview_json: JSON.stringify(preview),
    })
    return draftId
  }, overrides)
}

/** A minimal SpoolDocument suitable for drop-import tests. */
export function buildSampleSpoolDocument(opts: { title?: string; bodySuffix?: string } = {}): string {
  const conversation = {
    source: 'claude',
    sourceLabel: 'Claude',
    origin: { kind: 'file', filename: 'fixture.spool' },
    title: opts.title ?? 'Imported sample',
    shareUrl: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    wordCount: 12,
    readMin: 1,
    turns: [
      { role: 'user', body: `Hello from the e2e fixture${opts.bodySuffix ?? ''}` },
      { role: 'assistant', body: 'Imported reply — nice to meet you.' },
      { role: 'user', body: 'Just checking the import works end-to-end.' },
    ],
  }
  const editorOpts = {
    template: 'letter',
    paper: 'bone',
    typeface: 'fraunces',
    colorway: 'marine',
    accentHex: '#4A85B0',
    density: 'relaxed',
    redact: true,
    showGaps: true,
    showMasthead: true,
    showColophon: true,
    hideEmptyTurns: true,
  }
  return JSON.stringify({
    version: 1,
    conversation,
    opts: editorOpts,
    exportedAt: '2026-05-01T00:00:00.000Z',
  })
}

/**
 * Write a .spool fixture under e2e/fixtures/share-drafts/ so a test can
 * later read it from disk (e.g. to feed into a synthesized drop event).
 * Returns the absolute path.
 */
export function writeSpoolFixture(name: string, content: string): string {
  const path = join(FIXTURES_DIR, 'share-drafts', name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

/**
 * Simulate dropping a File onto a target element. Playwright doesn't have
 * a first-class drop event with File, so we synthesize the DataTransfer
 * inside the page and dispatch dragenter / dragover / drop in sequence —
 * which is what `useSpoolDrop` listens for.
 */
export async function dropFileOn(
  window: Page,
  selector: string,
  filename: string,
  content: string,
  mime = 'application/spool+json',
): Promise<void> {
  await window.evaluate(
    async (args) => {
      const target = document.querySelector(args.selector)
      if (!target) throw new Error(`drop target not found: ${args.selector}`)
      const file = new File([args.content], args.filename, { type: args.mime })
      const dt = new DataTransfer()
      dt.items.add(file)
      const fire = (type: string) => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
        target.dispatchEvent(ev)
      }
      fire('dragenter')
      fire('dragover')
      fire('drop')
    },
    { selector, filename, content, mime },
  )
}
