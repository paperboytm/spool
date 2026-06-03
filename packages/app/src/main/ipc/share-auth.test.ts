import { describe, expect, it, vi } from 'vitest'

import { performSignIn, type SignInDeps } from './share-auth.js'

function makeResult(token = 'new-token'): Awaited<ReturnType<SignInDeps['signIn']>> {
  return {
    session_token: token,
    user: {
      id: 'u-1',
      email: 'a@example.com',
      name: 'Alice',
      avatar_url: null,
      handle: null,
      deletion_pending_until: null,
    },
  }
}

describe('performSignIn', () => {
  it('skips revoke when no prior token exists', async () => {
    const revokePrior = vi.fn(async () => {})
    const saveToken = vi.fn()
    const signIn = vi.fn(async () => makeResult())
    await performSignIn({
      loadToken: () => null,
      saveToken,
      signIn,
      revokePrior,
    })
    expect(revokePrior).not.toHaveBeenCalled()
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(saveToken).toHaveBeenCalledWith('new-token')
  })

  it('revokes the prior session before issuing a new one', async () => {
    const calls: string[] = []
    const revokePrior = vi.fn(async () => {
      calls.push('revoke')
    })
    const signIn = vi.fn(async () => {
      calls.push('signin')
      return makeResult()
    })
    const saveToken = vi.fn((t: string) => {
      calls.push(`save:${t}`)
    })
    await performSignIn({
      loadToken: () => 'old-token',
      saveToken,
      signIn,
      revokePrior,
    })
    expect(calls).toEqual(['revoke', 'signin', 'save:new-token'])
  })

  it('proceeds with sign-in even when revoke fails (best-effort)', async () => {
    const revokePrior = vi.fn(async () => {
      throw new Error('network down')
    })
    const signIn = vi.fn(async () => makeResult('replacement'))
    const saveToken = vi.fn()
    const user = await performSignIn({
      loadToken: () => 'old-token',
      saveToken,
      signIn,
      revokePrior,
    })
    expect(revokePrior).toHaveBeenCalled()
    expect(saveToken).toHaveBeenCalledWith('replacement')
    expect(user.id).toBe('u-1')
  })
})
