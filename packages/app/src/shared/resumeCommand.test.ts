import { describe, expect, it } from 'vitest'
import { getSessionResumeCommand, getSessionResumeCommandPrefix } from './resumeCommand.js'

describe('getSessionResumeCommandPrefix', () => {
  it('returns the configured CLI prefix for resumable session sources', () => {
    expect(getSessionResumeCommandPrefix('claude')).toBe('claude --resume')
    expect(getSessionResumeCommandPrefix('codex')).toBe('codex fork')
    expect(getSessionResumeCommandPrefix('gemini')).toBe('gemini --resume')
    expect(getSessionResumeCommandPrefix('opencode')).toBe('opencode --session')
  })

  it('returns null for unsupported sources', () => {
    expect(getSessionResumeCommandPrefix('unknown-cli')).toBeNull()
  })
})

describe('getSessionResumeCommand', () => {
  it('builds fork-first commands so the original session is never appended to', () => {
    expect(getSessionResumeCommand('claude', 'test-session-uuid')).toBe("claude --resume 'test-session-uuid' --fork-session")
    expect(getSessionResumeCommand('codex', '11111111-2222-4333-8444-555555555555')).toBe("codex fork '11111111-2222-4333-8444-555555555555'")
    expect(getSessionResumeCommand('opencode', 'ses_123')).toBe("opencode --session 'ses_123' --fork")
    expect(getSessionResumeCommand('pi', '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9')).toBe("pi --fork '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'")
  })

  it('keeps plain --resume for gemini, which has no fork affordance', () => {
    expect(getSessionResumeCommand('gemini', '99999999-2222-4333-8444-555555555555')).toBe("gemini --resume '99999999-2222-4333-8444-555555555555'")
  })

  it('escapes embedded single quotes safely', () => {
    expect(getSessionResumeCommand('claude', "session'with'quotes")).toBe("claude --resume 'session'\\''with'\\''quotes' --fork-session")
  })

  it('prepends cd <cwd> && when cwd is provided', () => {
    expect(getSessionResumeCommand('claude', 'abc', '/Users/me/repo'))
      .toBe("cd '/Users/me/repo' && claude --resume 'abc' --fork-session")
  })

  it('omits cd prefix when cwd is null or empty', () => {
    expect(getSessionResumeCommand('claude', 'abc', null)).toBe("claude --resume 'abc' --fork-session")
    expect(getSessionResumeCommand('claude', 'abc', '')).toBe("claude --resume 'abc' --fork-session")
  })
})
