import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { makePfRuntime } from './pf-runtime.js'
import { PF_IPC } from '../../inference/types.js'

type FakeWindow = BrowserWindow & { destroyed: boolean }

function fakeWindow(id: number): FakeWindow {
  const w: Partial<FakeWindow> = {
    destroyed: false,
    webContents: {
      id,
      send: () => { /* no-op */ },
    } as unknown as BrowserWindow['webContents'],
    destroy() { (w as FakeWindow).destroyed = true },
    isDestroyed() { return (w as FakeWindow).destroyed },
  }
  return w as FakeWindow
}

function fakeIpc() {
  const bus = new EventEmitter()
  bus.setMaxListeners(50)
  const ipc = {
    on: (ch: string, fn: (...args: unknown[]) => void) => { bus.on(ch, fn); return ipc },
    removeListener: (ch: string, fn: (...args: unknown[]) => void) => { bus.removeListener(ch, fn); return ipc },
  }
  return { ipc, bus }
}

describe('makePfRuntime', () => {
  it('isActive flips on after start, off after stop', async () => {
    const win = fakeWindow(50)
    const { ipc, bus } = fakeIpc()
    const rt = makePfRuntime({
      ipc,
      spawnWindow: async () => {
        setTimeout(() => bus.emit(PF_IPC.READY, { sender: { id: 50 } }, {
          runtime: 'wasm', detectionMs: 1,
        }), 0)
        return win
      },
    })
    expect(rt.isActive()).toBe(false)
    await rt.start()
    expect(rt.isActive()).toBe(true)
    await rt.stop()
    expect(rt.isActive()).toBe(false)
    expect(win.destroyed).toBe(true)
  })

  it('start is idempotent — calling it twice mounts a single host', async () => {
    let spawned = 0
    const { ipc, bus } = fakeIpc()
    const rt = makePfRuntime({
      ipc,
      spawnWindow: async () => {
        spawned++
        const w = fakeWindow(60 + spawned)
        setTimeout(() => bus.emit(PF_IPC.READY, { sender: { id: w.webContents.id } }, {
          runtime: 'wasm', detectionMs: 1,
        }), 0)
        return w
      },
    })
    await Promise.all([rt.start(), rt.start()])
    expect(spawned).toBe(1)
    await rt.stop()
  })

  it('analyze returns [] when not active', async () => {
    const rt = makePfRuntime({ spawnWindow: async () => { throw new Error('not used') } })
    expect(await rt.analyze('hi')).toEqual([])
  })

  it('getState returns null when not active', async () => {
    const rt = makePfRuntime({ spawnWindow: async () => { throw new Error('not used') } })
    expect(await rt.getState()).toBeNull()
  })

  it('stop is idempotent — calling it twice without start is fine', async () => {
    const rt = makePfRuntime({ spawnWindow: async () => { throw new Error('not used') } })
    await rt.stop()
    await rt.stop()
    expect(rt.isActive()).toBe(false)
  })
})
