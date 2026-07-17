import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editNote } from './note-editor.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-note-editor-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('editNote', () => {
  it('uses -m text without launching an editor', () => {
    expect(editNote('generated draft', {
      message: 'A note from the command line',
      env: { ...process.env, EDITOR: '/definitely/not/an/editor' },
    })).toBe('A note from the command line')
  })

  it('uses the deterministic prefill unchanged for --no-edit', () => {
    const prefill = 'Intent: repair auth\nFiles: src/auth.ts\n'

    expect(editNote(prefill, {
      noEdit: true,
      env: { ...process.env, EDITOR: '/definitely/not/an/editor' },
    })).toBe(prefill)
  })

  it('opens a comment-prefilled file and strips comment lines on save', () => {
    const dir = makeTempDir()
    const editor = join(dir, 'fake-editor.sh')
    writeFileSync(editor, `#!/bin/sh
set -eu
/usr/bin/grep -q '^# Intent: repair auth$' "$1"
/usr/bin/grep -q '^# Files: src/auth.ts$' "$1"
/usr/bin/printf 'A human note\n# discard this line\nkept # inline hash\n' > "$1"
`)
    chmodSync(editor, 0o755)

    expect(editNote('Intent: repair auth\nFiles: src/auth.ts', {
      env: { ...process.env, EDITOR: editor },
    })).toBe('A human note\nkept # inline hash')
  })

  it('keeps a saved note even when the editor exits nonzero', () => {
    const dir = makeTempDir()
    const editor = join(dir, 'grumpy-editor.sh')
    writeFileSync(editor, `#!/bin/sh
/usr/bin/printf 'Saved before the editor complained\n' > "$1"
exit 1
`)
    chmodSync(editor, 0o755)

    expect(editNote('draft', { env: { ...process.env, EDITOR: editor } }))
      .toBe('Saved before the editor complained')
  })

  it('aborts on nonzero exit only when the note was untouched', () => {
    const dir = makeTempDir()
    const editor = join(dir, 'failing-editor.sh')
    writeFileSync(editor, `#!/bin/sh
exit 1
`)
    chmodSync(editor, 0o755)

    expect(() => editNote('draft', { env: { ...process.env, EDITOR: editor } }))
      .toThrow(/was not modified — aborting/)
  })
})
