// Regression test for the muted-kinds refresh bug (May 2026).
//
// The Security Scan IPC layer forks a fiber that subscribes to the
// worker's `Stream.fromPubSub(events)` and forwards each event over
// `webContents.send`. The original implementation used:
//
//   Effect.runPromise(Effect.fork(streamRunForEach(...)))
//
// which attached the forked fiber to the implicit runtime scope
// `Effect.runPromise` creates. That scope closes the instant
// `runPromise` resolves with the fiber handle, interrupting the
// forwarder before it sees its first event. UI surface: muting a
// kind in Settings wrote `state='dismissed'` to the DB correctly,
// but the Security page never received `session-rescanned` and so
// never re-fetched.
//
// The fix is `Effect.forkDaemon`, which detaches the fiber from the
// parent scope so it lives until explicitly interrupted.

import { describe, it, expect } from 'vitest'
import { Effect, Fiber, PubSub, Stream } from 'effect'

async function publishAndCollect(
  forker: (pubsub: PubSub.PubSub<number>, sink: (n: number) => void) => Promise<Fiber.RuntimeFiber<void, never>>,
): Promise<number[]> {
  const received: number[] = []
  const pubsub = await Effect.runPromise(PubSub.unbounded<number>())
  const fiber = await forker(pubsub, (n) => { received.push(n) })

  // Give the subscriber a tick to register.
  await new Promise((r) => setTimeout(r, 20))

  await Effect.runPromise(PubSub.publish(pubsub, 1))
  await Effect.runPromise(PubSub.publish(pubsub, 2))
  await Effect.runPromise(PubSub.publish(pubsub, 3))

  // Give the consumer a tick to drain.
  await new Promise((r) => setTimeout(r, 20))

  await Effect.runPromise(Fiber.interrupt(fiber))
  return received
}

describe('IPC forwarder fork pattern', () => {
  it('Effect.runPromise(Effect.fork(...)) DROPS events — fiber is interrupted with the implicit runtime scope', async () => {
    const got = await publishAndCollect(async (pubsub, sink) => {
      // Buggy pattern — what the IPC layer originally used.
      const fiber = await Effect.runPromise(
        Effect.fork(
          Stream.runForEach(Stream.fromPubSub(pubsub), (n) => Effect.sync(() => sink(n))),
        ),
      )
      return fiber as Fiber.RuntimeFiber<void, never>
    })
    // The fiber is killed as soon as runPromise resolves, so nothing
    // (or close to nothing) is delivered. We assert <3 rather than
    // ===0 because Effect runtime may deliver a few events during
    // the scope-teardown race; the point is that the subscription
    // does NOT outlive the runPromise that created it.
    expect(got.length).toBeLessThan(3)
  })

  it('Effect.runPromise(Effect.forkDaemon(...)) DELIVERS all events — daemon detaches from the parent scope', async () => {
    const got = await publishAndCollect(async (pubsub, sink) => {
      // Fixed pattern — daemon fiber survives the runPromise scope.
      const fiber = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* Effect.forkDaemon(
            Stream.runForEach(Stream.fromPubSub(pubsub), (n) => Effect.sync(() => sink(n))),
          )
        }),
      )
      return fiber
    })
    expect(got).toEqual([1, 2, 3])
  })
})
