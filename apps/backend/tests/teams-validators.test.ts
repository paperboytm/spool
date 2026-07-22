import { describe, expect, it } from 'vite-plus/test'

import { parseCreateTeamBody, requireIdempotencyKey } from '../src/teams/validators'

describe('Team input normalization', () => {
  it('normalizes Team names with NFKC before persistence', async () => {
    await expect(
      parseCreateTeamBody(
        new Request('https://spool.new/api/teams', {
          method: 'POST',
          body: JSON.stringify({ name: '  Ａｃｍｅ  ' }),
        }),
      ),
    ).resolves.toEqual({ name: 'Acme' })
  })

  it('rejects control and bidi-format characters in Team names', async () => {
    await expect(
      parseCreateTeamBody(
        new Request('https://spool.new/api/teams', {
          method: 'POST',
          body: JSON.stringify({ name: 'safe\u202Etxt' }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE' })
  })

  it('requires a reusable, bounded Idempotency-Key', () => {
    expect(
      requireIdempotencyKey(
        new Request('https://spool.new/api/teams', {
          headers: { 'idempotency-key': 'create-team-operation-1' },
        }),
      ),
    ).toBe('create-team-operation-1')
    expect(() => requireIdempotencyKey(new Request('https://spool.new/api/teams'))).toThrow(
      /Idempotency-Key/,
    )
  })
})
