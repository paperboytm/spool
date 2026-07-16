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
    writeFileSync(notePath, `\n${commentPrefill(prefillDraft)}\n`, 'utf8')
    const result = spawnSync(editor, [notePath], {
      env,
      stdio: 'inherit',
      shell: true,
    })

    if (result.error) {
      throw new Error(`Could not launch editor "${editor}": ${result.error.message}`)
    }
    if (result.status !== 0) {
      throw new Error(`Editor "${editor}" exited with status ${result.status ?? 'unknown'}`)
    }

    return stripCommentLines(readFileSync(notePath, 'utf8'))
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
