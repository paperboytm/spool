import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface NoteEditorOptions {
  message?: string
  noEdit?: boolean
  env?: NodeJS.ProcessEnv
}

/**
 * Resolve a share note using git-commit-style semantics.
 *
 * An explicit message and --no-edit are bypasses. Otherwise the deterministic
 * prefill is shown as comment-only guidance and only author-written,
 * non-comment lines are returned.
 */
export function editNote(prefillDraft: string, options: NoteEditorOptions = {}): string {
  if (options.message !== undefined) return options.message
  if (options.noEdit === true) return prefillDraft

  const env = options.env ?? process.env
  const editor = env['EDITOR']?.trim() || 'vi'
  const directory = mkdtempSync(join(tmpdir(), 'spool-note-'))
  const notePath = join(directory, 'SPOOL_NOTE.md')

  try {
    const initial = `\n${commentPrefill(prefillDraft)}\n`
    writeFileSync(notePath, initial, 'utf8')
    const result = spawnSync(editor, [notePath], {
      env,
      stdio: 'inherit',
      shell: true,
    })

    if (result.error) {
      throw new Error(`Could not launch editor "${editor}": ${result.error.message} (set $EDITOR)`)
    }

    const saved = readFileSync(notePath, 'utf8')
    // A nonzero exit only aborts when the author saved nothing: editors
    // exit nonzero for reasons unrelated to the note (vimrc errors, :cq
    // habits), and discarding a note someone actually wrote is worse
    // than tolerating a grumpy editor.
    if (result.status !== 0 && saved === initial) {
      throw new Error(
        `Editor "${editor}" exited with status ${result.status ?? 'unknown'} and the note was not modified — aborting. Use -m "<note>" or --no-edit to skip the editor.`,
      )
    }

    return stripCommentLines(saved)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function commentPrefill(prefillDraft: string): string {
  return normalizeNewlines(prefillDraft)
    .split('\n')
    .map(line => line === '' ? '#' : `# ${line}`)
    .join('\n')
}

function stripCommentLines(note: string): string {
  return normalizeNewlines(note)
    .split('\n')
    .filter(line => !line.startsWith('#'))
    .join('\n')
    .trim()
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}
