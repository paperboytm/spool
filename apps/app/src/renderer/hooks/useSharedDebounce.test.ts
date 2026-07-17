import { describe, it, expect } from 'vitest'
import { createSharedDebounce } from './useSharedDebounce.js'

/** Minimal manual timer host — fire() runs the pending callback. */
function fakeTimers() {
  let next = 1
  const pending = new Map<number, () => void>()
  return {
    host: {
      setTimeout: (fn: () => void, _ms: number) => {
        const h = next++
        pending.set(h, fn)
        return h
      },
      clearTimeout: (h: number) => {
        pending.delete(h)
      },
    },
    fire: () => {
      const fns = Array.from(pending.values())
      pending.clear()
      for (const fn of fns) fn()
    },
    pendingCount: () => pending.size,
  }
}

describe('createSharedDebounce', () => {
  it('runs every pending task once when the shared window fires', () => {
    const t = fakeTimers()
    const d = createSharedDebounce(400, t.host)
    const ran: string[] = []
    d.schedule('save', () => ran.push('save'))
    d.schedule('drift', () => ran.push('drift'))
    // One shared timer, not one per task.
    expect(t.pendingCount()).toBe(1)
    t.fire()
    expect(ran).toEqual(['save', 'drift'])
    // Tasks don't re-run on a later window.
    d.schedule('save', () => ran.push('save2'))
    t.fire()
    expect(ran).toEqual(['save', 'drift', 'save2'])
  })

  it('re-scheduling a key replaces its pending callback (trailing debounce)', () => {
    const t = fakeTimers()
    const d = createSharedDebounce(400, t.host)
    const ran: string[] = []
    d.schedule('save', () => ran.push('stale'))
    d.schedule('save', () => ran.push('latest'))
    t.fire()
    expect(ran).toEqual(['latest'])
  })

  it('re-arming for one key keeps the other key pending until the new window fires', () => {
    const t = fakeTimers()
    const d = createSharedDebounce(400, t.host)
    const ran: string[] = []
    d.schedule('save', () => ran.push('save'))
    d.schedule('drift', () => ran.push('drift'))
    // A new edit re-arms via 'save' — drift must survive into the new window.
    d.schedule('save', () => ran.push('save'))
    t.fire()
    expect(ran.sort()).toEqual(['drift', 'save'])
  })

  it('cancel drops one task; dispose drops everything silently', () => {
    const t = fakeTimers()
    const d = createSharedDebounce(400, t.host)
    const ran: string[] = []
    d.schedule('save', () => ran.push('save'))
    d.schedule('drift', () => ran.push('drift'))
    d.cancel('drift')
    t.fire()
    expect(ran).toEqual(['save'])

    d.schedule('save', () => ran.push('after-dispose'))
    d.dispose()
    t.fire()
    expect(ran).toEqual(['save'])
    expect(t.pendingCount()).toBe(0)
  })
})
