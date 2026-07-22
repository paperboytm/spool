import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { scheduleAccountDeletion } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('scheduleAccountDeletion', () => {
  it('returns the backend detail when an active Team ownership conflict blocks deletion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(409, {
          error: 'CONFLICT',
          detail: 'transfer or archive every Team you own before deleting your account',
        }),
      ),
    )

    await expect(scheduleAccountDeletion()).resolves.toEqual({
      kind: 'conflict',
      detail: 'transfer or archive every Team you own before deleting your account',
    })
  })

  it('keeps a typed conflict when the backend omits usable detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(409, { error: 'CONFLICT' })),
    )

    await expect(scheduleAccountDeletion()).resolves.toEqual({ kind: 'conflict' })
  })
})
