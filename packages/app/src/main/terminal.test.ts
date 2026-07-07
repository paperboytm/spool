// Unit tests for terminal resume launching. We stub `electron` (only
// `shell.openExternal` is used) and `node:child_process` so the runners
// can be exercised without opening real terminal windows, then assert
// on the exact command each runner emits.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const execSync = vi.fn()
const spawn = vi.fn(() => ({ unref: () => {} }))

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => execSync(...args),
  spawn: (...args: unknown[]) => spawn(...args),
}))

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
      `open -a Ghostty --args -e sh -c 'cd '/tmp/proj' && spool-resume echo; exec $SHELL'`,
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
