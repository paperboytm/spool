// Unit tests for terminal resume launching. We stub `electron` (only
// `shell.openExternal` is used) and `node:child_process` so the runners
// can be exercised without opening real terminal windows, then assert
// on the exact command each runner emits.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'

const execSync = vi.fn()
const spawn = vi.fn(() => ({ unref: () => {} }))

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>()
  return {
    ...actual,
    execSync: (...args: unknown[]) => execSync(...args),
    spawn: (...args: unknown[]) => spawn(...args),
  }
})

const existsSync = vi.fn(() => true)

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>()
  return { ...actual, existsSync: (...args: unknown[]) => existsSync(...args) }
})

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}))

// The macOS terminal runners are what we're testing, but CI runs the unit
// suite on ubuntu, where openTerminal takes the Linux `xdg-terminal-exec`
// branch instead. Pin the platform to darwin before terminal.js captures
// IS_LINUX at import time so the runners are exercised on any host.
const realPlatform = process.platform
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

const { SUPPORTED_TERMINALS, openTerminal } = await import('./terminal.js')

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
})

beforeEach(() => {
  execSync.mockClear()
  spawn.mockClear()
  existsSync.mockReturnValue(true)
})

/**
 * Reproduce how the outer `/bin/sh -c` (what execSync runs) tokenizes the
 * emitted command, and return the argument list that follows `sh -c`.
 * The runners must hand the terminal a single argument; anything more means
 * the outer shell split the payload and the resume command would break.
 */
function shArgsOf(emitted: string): string[] {
  const dump = emitted.replace(/^open -a \S+ --args (?:-e |start -- )?sh -c /, `printf '%s\\n' `)
  return execFileSync('/bin/sh', ['-c', dump]).toString().split('\n').slice(0, -1)
}

describe('SUPPORTED_TERMINALS', () => {
  it('includes Ghostty', () => {
    expect(SUPPORTED_TERMINALS).toContain('Ghostty')
  })
})

describe('openTerminal — Ghostty', () => {
  it('launches Ghostty via `open --args -e` and prepends cd for the cwd', () => {
    openTerminal('spool-resume echo', 'Ghostty', '/tmp/proj')

    expect(execSync).toHaveBeenCalledTimes(1)
    expect(execSync.mock.calls[0][0]).toBe(
      `open -a Ghostty --args -e sh -c 'cd '\\''/tmp/proj'\\'' && spool-resume echo; exec $SHELL'`,
    )
  })

  it('omits the cd prefix when no cwd is given', () => {
    openTerminal('spool-resume echo', 'Ghostty')

    expect(execSync.mock.calls[0][0]).toBe(
      `open -a Ghostty --args -e sh -c 'spool-resume echo; exec $SHELL'`,
    )
  })

  it('keeps the window alive with `exec $SHELL`', () => {
    openTerminal('spool-resume echo', 'Ghostty')
    expect(execSync.mock.calls[0][0]).toContain('exec $SHELL')
  })
})

// Regression: the `sh -c` payload must survive the outer shell as ONE
// argument even when the cwd or command contains a space or a single quote.
// Before the fix, the runners wrapped the payload in raw single quotes, so a
// path like "/tmp/My Proj" split into "cd /tmp/My" + "Proj && …" and the
// resume command was dropped.
describe('openTerminal — CLI runners keep the payload as one shell token', () => {
  const cases: Array<[string, RegExp]> = [
    ['Ghostty', /^open -a Ghostty --args -e sh -c /],
    ['kitty', /^open -a kitty --args sh -c /],
    ['Alacritty', /^open -a Alacritty --args -e sh -c /],
    ['WezTerm', /^open -a WezTerm --args start -- sh -c /],
  ]

  for (const [terminal, prefix] of cases) {
    it(`${terminal}: a cwd with a space stays intact`, () => {
      openTerminal('spool-resume echo', terminal, '/tmp/My Proj')

      const emitted = execSync.mock.calls[0][0] as string
      expect(emitted).toMatch(prefix)
      expect(shArgsOf(emitted)).toEqual([`cd '/tmp/My Proj' && spool-resume echo; exec $SHELL`])
    })

    it(`${terminal}: a command with a single quote stays intact`, () => {
      openTerminal(`say 'hi there'`, terminal)

      const emitted = execSync.mock.calls[0][0] as string
      expect(shArgsOf(emitted)).toEqual([`say 'hi there'; exec $SHELL`])
    })
  }
})
