import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { makePfRuntime } from './pf-runtime.js'
import { PF_IPC } from '../../renderer/inference/types.js'

type FakeWindow = BrowserWindow & { destroyed: boolean; crash: () => void }

function fakeWindow(id: number): FakeWindow {
  // webContents is an EventEmitter so the host can attach its
  // `render-process-gone` listener; `crash()` drives it in tests.
  const wc = new EventEmitter() as unknown as BrowserWindow['webContents']
  ;(wc as unknown as { id: number }).id = id
  ;(wc as unknown as { send: () => void }).send = () => { /* no-op */ }
  const w: Partial<FakeWindow> = {
    destroyed: false,
    webContents: wc,
    destroy() { (w as FakeWindow).destroyed = true },
    isDestroyed() { return (w as FakeWindow).destroyed },
    crash() { (wc as unknown as EventEmitter).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 }) },
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

  it('post-handshake renderer crash flips state to failed and fires onCrash', async () => {
    const win = fakeWindow(55)
    const { ipc, bus } = fakeIpc()
    let crashes = 0
    const rt = makePfRuntime({
      ipc,
      onCrash: () => { crashes++ },
      spawnWindow: async () => {
        setTimeout(() => bus.emit(PF_IPC.READY, { sender: { id: 55 } }, {
          runtime: 'wasm', detectionMs: 1,
        }), 0)
        return win
      },
    })
    await rt.start()
    // Handshake succeeded — host reports ready.
    expect((await rt.getState())?.status).toBe('ready')

    // Render process dies after handshake. Pre-fix: state stays
    // `ready`, onCrash never fires, scan worker keeps stamping pf@...
    win.crash()
    // Let the async Ref.set settle.
    await new Promise((r) => setTimeout(r, 0))

    expect((await rt.getState())?.status).toBe('failed')
    expect(crashes).toBe(1)
    await rt.stop()
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
