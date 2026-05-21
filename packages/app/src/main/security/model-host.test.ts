import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Effect } from 'effect'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import { makeModelHost, type ModelHostDeps } from './model-host.js'
import { PF_IPC, type PfReadyMessage } from '../../inference/types.js'

type FakeWindow = BrowserWindow & { destroyed: boolean }

/** Minimal stand-ins for the bits of `BrowserWindow` and `ipcMain` the
 *  ModelHost touches — vitest can't import the real ones because they
 *  require Electron's main process. */
function fakeBrowserWindow(id: number): FakeWindow {
  const w: Partial<FakeWindow> = {
    destroyed: false,
    webContents: { id } as BrowserWindow['webContents'],
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

const senderEvent = (id: number) => ({ sender: { id } }) as IpcMainEvent

/** Build deps that spawn a fake window with the given id and immediately
 *  schedule a ready (or failed) emission from that sender. */
function depsEmittingReady(id: number, payload: PfReadyMessage): { deps: ModelHostDeps; win: FakeWindow } {
  const win = fakeBrowserWindow(id)
  const { ipc, bus } = fakeIpc()
  const deps: ModelHostDeps = {
    spawnWindow: async () => {
      setTimeout(() => bus.emit(PF_IPC.READY, senderEvent(id), payload), 0)
      return win
    },
    ipc,
  }
  return { deps, win }
}

describe('makeModelHost', () => {
  it('reports ready + runtime once the inference window fires pf:ready', async () => {
    const { deps } = depsEmittingReady(11, {
      runtime: 'webgpu', adapterLabel: 'Apple M2 Pro', detectionMs: 42,
    })
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return { state: yield* host.getState, isReady: yield* host.ready }
    })))
    expect(out.isReady).toBe(true)
    expect(out.state.status).toBe('ready')
    expect(out.state.runtime).toBe('webgpu')
    expect(out.state.adapterLabel).toBe('Apple M2 Pro')
    expect(out.state.detectionMs).toBe(42)
  })

  it('destroys the hidden window when the scope closes', async () => {
    const { deps, win } = depsEmittingReady(12, { runtime: 'wasm', detectionMs: 7 })
    await Effect.runPromise(Effect.scoped(makeModelHost(deps).pipe(Effect.asVoid)))
    expect(win.destroyed).toBe(true)
  })

  it('does not double-destroy if the window is already gone', async () => {
    const { deps, win } = depsEmittingReady(13, { runtime: 'wasm', detectionMs: 5 })
    const destroy = vi.spyOn(win, 'destroy')
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      yield* makeModelHost(deps)
      // Simulate the window getting destroyed mid-scope (e.g. user
      // explicitly killed it). Release path must NOT throw.
      win.destroyed = true
    })))
    expect(destroy).not.toHaveBeenCalled()
  })

  it('ignores pf:ready from a different webContents id', async () => {
    const win = fakeBrowserWindow(20)
    const { ipc, bus } = fakeIpc()
    const deps: ModelHostDeps = {
      spawnWindow: async () => {
        // Wrong sender id arrives first — should be ignored.
        setTimeout(() => bus.emit(PF_IPC.READY, senderEvent(99), {
          runtime: 'webgpu', detectionMs: 1,
        }), 0)
        // Real sender follows.
        setTimeout(() => bus.emit(PF_IPC.READY, senderEvent(20), {
          runtime: 'wasm', detectionMs: 3,
        }), 5)
        return win
      },
      ipc,
      readyTimeoutMs: 200,
    }
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return yield* host.getState
    })))
    expect(out.runtime).toBe('wasm')
  })

  it('lands in failed state on handshake timeout, but does not throw', async () => {
    const win = fakeBrowserWindow(21)
    const { ipc } = fakeIpc()
    const deps: ModelHostDeps = {
      spawnWindow: async () => win,
      ipc,
      readyTimeoutMs: 25,
    }
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return { state: yield* host.getState, isReady: yield* host.ready }
    })))
    expect(out.isReady).toBe(false)
    expect(out.state.status).toBe('failed')
    expect(out.state.error).toMatch(/timed out/)
    expect(win.destroyed).toBe(true)
  })

  it('lands in failed state when the renderer reports pf:failed', async () => {
    const win = fakeBrowserWindow(22)
    const { ipc, bus } = fakeIpc()
    const deps: ModelHostDeps = {
      spawnWindow: async () => {
        setTimeout(() =>
          bus.emit(PF_IPC.FAILED, senderEvent(22), { message: 'adapter request threw' }),
          0,
        )
        return win
      },
      ipc,
    }
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return yield* host.getState
    })))
    expect(out.status).toBe('failed')
    expect(out.error).toBe('adapter request threw')
  })

  it('lands in failed state when spawnWindow rejects', async () => {
    const { ipc } = fakeIpc()
    const deps: ModelHostDeps = {
      spawnWindow: async () => { throw new Error('window creation blew up') },
      ipc,
    }
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return yield* host.getState
    })))
    expect(out.status).toBe('failed')
    expect(out.error).toMatch(/blew up/)
  })

  it('analyze returns [] in PR 5a — model inference lands in 5c', async () => {
    const { deps } = depsEmittingReady(23, { runtime: 'wasm', detectionMs: 1 })
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return yield* host.analyze('contains a@b.c')
    })))
    expect(out).toEqual([])
  })
})
