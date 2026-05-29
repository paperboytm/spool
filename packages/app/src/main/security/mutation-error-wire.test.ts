// Regression tests for the Effect.Exit → wire transformation in the
// mutation worker. The test file motivating this module is the
// self-reviewed bug on PR #N that was caught only because the human
// reviewer asked the agent to double-check the `Exit.causeOption`
// shape — without these tests, the same regression would slip back in
// silently the next time someone touches the worker.
//
// What we're guarding:
//   - Typed `PurgeError` from `@spool-lab/core` must round-trip with
//     its `reason` AND `findingId` intact, so the renderer's
//     reason-keyed error UI fires for worker-routed calls (which is
//     every purge call once the worker is booted).
//   - Defects (Effect.die / thrown inside Effect.gen) and interrupts
//     must NOT pretend to be typed PurgeErrors. They flatten to a
//     `reason: 'unknown'` envelope so the renderer falls back to its
//     generic error toast instead of branching on the wrong reason.

import { describe, it, expect } from 'vitest'
import { Data, Effect } from 'effect'
import {
  exitToWireResult,
  flattenPurgeError,
  unwrapEffectFailure,
  type PurgeErrorWire,
} from './mutation-error-wire.js'

// Local mirror of the core PurgeError tagged class — keeping this
// test file zero-dep on @spool-lab/core so the regression survives
// even if the core package fails to build for unrelated reasons.
class TestPurgeError extends Data.TaggedError('PurgeError')<{
  readonly findingId: number
  readonly reason: PurgeErrorWire['reason']
  readonly cause?: unknown
}> {}

describe('unwrapEffectFailure', () => {
  it('returns null for a successful exit', async () => {
    const exit = await Effect.runPromiseExit(Effect.succeed(42))
    expect(unwrapEffectFailure(exit)).toBeNull()
  })

  it('unwraps a typed Fail down to the raw E (the bug-fix path)', async () => {
    const err = new TestPurgeError({ findingId: 7, reason: 'not-found' })
    const exit = await Effect.runPromiseExit(Effect.fail(err))
    const out = unwrapEffectFailure(exit)
    // Bug pre-fix returned a Cause<E> here, not E. Asserting the
    // unwrapped instance has the typed fields the renderer reads
    // pins the contract.
    expect(out).toBeInstanceOf(TestPurgeError)
    expect(out).toMatchObject({ findingId: 7, reason: 'not-found' })
  })

  it('returns null for a defect (Effect.die) — defects are not typed failures', async () => {
    const exit = await Effect.runPromiseExit(Effect.die(new Error('boom')))
    expect(unwrapEffectFailure(exit)).toBeNull()
  })

  it('returns null for a thrown synchronous exception inside a generator', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* Effect.sync(() => { throw new Error('oops') })
      }),
    )
    expect(unwrapEffectFailure(exit)).toBeNull()
  })
})

describe('flattenPurgeError', () => {
  it.each([
    'not-found',
    'already-purged',
    'message-missing',
    'db-failed',
  ] as const)('preserves reason=%s and findingId from a typed PurgeError-shaped object', (reason) => {
    expect(flattenPurgeError({ reason, findingId: 5 })).toEqual({ reason, findingId: 5 })
  })

  it('attaches cause.message when present, omits when not', () => {
    expect(flattenPurgeError({ reason: 'db-failed', findingId: 9, cause: new Error('disk full') }))
      .toEqual({ reason: 'db-failed', findingId: 9, message: 'disk full' })
    expect(flattenPurgeError({ reason: 'db-failed', findingId: 9 }))
      .toEqual({ reason: 'db-failed', findingId: 9 })
  })

  it('downgrades a plain Error to reason=unknown with its message', () => {
    expect(flattenPurgeError(new Error('something else'))).toEqual({
      reason: 'unknown',
      message: 'something else',
    })
  })

  it('downgrades null / undefined / strings to reason=unknown', () => {
    expect(flattenPurgeError(null)).toEqual({ reason: 'unknown', message: 'null' })
    expect(flattenPurgeError(undefined)).toEqual({ reason: 'unknown', message: 'undefined' })
    expect(flattenPurgeError('boom')).toEqual({ reason: 'unknown', message: 'boom' })
  })

  it('rejects shapes that look close but miss the contract (no findingId, wrong type)', () => {
    // Missing findingId — must NOT be accepted as a PurgeError shape.
    expect(flattenPurgeError({ reason: 'not-found' })).toEqual({
      reason: 'unknown',
      message: expect.any(String),
    })
    // findingId of wrong type — must NOT be accepted.
    expect(flattenPurgeError({ reason: 'not-found', findingId: '5' })).toEqual({
      reason: 'unknown',
      message: expect.any(String),
    })
  })
})

describe('exitToWireResult', () => {
  it('shapes a successful exit through the per-command success transformer', async () => {
    const exit = await Effect.runPromiseExit(Effect.succeed({ findingId: 1, sessionId: 2 }))
    const wire = exitToWireResult(exit, (v) => ({ id: v.findingId, session: v.sessionId }))
    expect(wire).toEqual({ ok: true, success: { id: 1, session: 2 } })
  })

  it('shapes a typed failure as { ok: false, error: PurgeErrorWire }', async () => {
    const err = new TestPurgeError({ findingId: 12, reason: 'already-purged' })
    const exit = await Effect.runPromiseExit(Effect.fail(err))
    const wire = exitToWireResult(exit, (v) => v)
    expect(wire).toEqual({
      ok: false,
      error: { reason: 'already-purged', findingId: 12 },
    })
  })

  it('shapes a defect as { ok: false, error: { reason: "unknown" } }', async () => {
    const exit = await Effect.runPromiseExit(Effect.die(new Error('out of memory')))
    const wire = exitToWireResult(exit, (v) => v)
    expect(wire).toEqual({
      ok: false,
      error: { reason: 'unknown', message: expect.any(String) },
    })
  })
})
