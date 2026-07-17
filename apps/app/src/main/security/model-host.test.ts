import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Effect } from 'effect'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import { makeModelHost, type ModelHostDeps } from './model-host.js'
import { PF_IPC, type PfReadyMessage } from '../../renderer/inference/types.js'

type FakeWindow = BrowserWindow & { destroyed: boolean; crash: () => void }

/** Minimal stand-ins for the bits of `BrowserWindow` and `ipcMain` the
 *  ModelHost touches — vitest can't import the real ones because they
 *  require Electron's main process. webContents is an EventEmitter so
 *  the host can attach its `render-process-gone` listener. */
function fakeBrowserWindow(id: number): FakeWindow {
  const wc = new EventEmitter() as unknown as BrowserWindow['webContents']
  ;(wc as unknown as { id: number }).id = id
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

  it('transitions to failed and fires onCrash on a post-handshake render-process-gone', async () => {
    const { deps, win } = depsEmittingReady(14, { runtime: 'wasm', detectionMs: 3 })
    let crashes = 0
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost({ ...deps, onCrash: () => { crashes++ } })
      const readyBefore = yield* host.ready
      // Renderer dies after a successful handshake. Pre-fix the host
      // kept reporting `ready`, so scans silently went regex-only while
      // the profile string still claimed pf@... coverage.
      win.crash()
      yield* Effect.sleep('1 millis')
      const stateAfter = yield* host.getState
      const readyAfter = yield* host.ready
      return { readyBefore, stateAfter, readyAfter }
    })))
    expect(out.readyBefore).toBe(true)
    expect(out.readyAfter).toBe(false)
    expect(out.stateAfter.status).toBe('failed')
    expect(crashes).toBe(1)
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

  it('analyze fails fast when the host is not ready', async () => {
    const win = fakeBrowserWindow(30)
    const { ipc } = fakeIpc()
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost({
        spawnWindow: async () => win,
        ipc,
        readyTimeoutMs: 20,
      })
      return yield* Effect.either(host.analyze('hello'))
    })))
    expect(result._tag).toBe('Left')
  })

  it('analyze routes a request to the inference window and resolves the matching result', async () => {
    const win = fakeBrowserWindowWithSender(31)
    const { ipc, bus } = fakeIpc()
    const deps: ModelHostDeps = {
      spawnWindow: async () => {
        setTimeout(() => bus.emit(PF_IPC.READY, senderEvent(31), {
          runtime: 'webgpu', detectionMs: 1,
        }), 0)
        return win
      },
      ipc,
    }
    // Simulate the inference window: as soon as a request is sent, fake
    // a response back through the bus on the result channel.
    win.webContents.sendImpl = (channel: string, payload: unknown) => {
      if (channel !== PF_IPC.ANALYZE_REQUEST) return
      const req = payload as { reqId: number; text: string }
      setTimeout(() => bus.emit(PF_IPC.ANALYZE_RESULT, senderEvent(31), {
        reqId: req.reqId, ok: true,
        matches: [{ class: 'email', value: req.text, start: 0, end: req.text.length, score: 0.9 }],
      }), 0)
    }
    const matches = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return yield* host.analyze('a@b.c')
    })))
    expect(matches).toEqual([{ class: 'email', value: 'a@b.c', start: 0, end: 5, score: 0.9 }])
  })

  it('analyze ignores results from a different sender id', async () => {
    const win = fakeBrowserWindowWithSender(32)
    const { ipc, bus } = fakeIpc()
    const deps: ModelHostDeps = {
      spawnWindow: async () => {
        setTimeout(() => bus.emit(PF_IPC.READY, senderEvent(32), {
          runtime: 'wasm', detectionMs: 1,
        }), 0)
        return win
      },
      ipc,
      analyzeTimeoutMs: 50,
    }
    win.webContents.sendImpl = (channel: string, payload: unknown) => {
      if (channel !== PF_IPC.ANALYZE_REQUEST) return
      const req = payload as { reqId: number; text: string }
      // Wrong sender — should be ignored, request times out.
      setTimeout(() => bus.emit(PF_IPC.ANALYZE_RESULT, senderEvent(999), {
        reqId: req.reqId, ok: true, matches: [],
      }), 0)
    }
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return yield* Effect.either(host.analyze('x'))
    })))
    expect(out._tag).toBe('Left')
  })

  it('analyze times out when the inference window never responds', async () => {
    const win = fakeBrowserWindowWithSender(33)
    const { ipc, bus } = fakeIpc()
    const deps: ModelHostDeps = {
      spawnWindow: async () => {
        setTimeout(() => bus.emit(PF_IPC.READY, senderEvent(33), {
          runtime: 'wasm', detectionMs: 1,
        }), 0)
        return win
      },
      ipc,
      analyzeTimeoutMs: 30,
    }
    win.webContents.sendImpl = () => { /* swallow */ }
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return yield* Effect.either(host.analyze('x'))
    })))
    expect(out._tag).toBe('Left')
    if (out._tag === 'Left') {
      expect(String(out.left.cause)).toMatch(/timed out/)
    }
  })

  it('analyze propagates inference-side errors', async () => {
    const win = fakeBrowserWindowWithSender(34)
    const { ipc, bus } = fakeIpc()
    const deps: ModelHostDeps = {
      spawnWindow: async () => {
        setTimeout(() => bus.emit(PF_IPC.READY, senderEvent(34), {
          runtime: 'wasm', detectionMs: 1,
        }), 0)
        return win
      },
      ipc,
    }
    win.webContents.sendImpl = (channel: string, payload: unknown) => {
      if (channel !== PF_IPC.ANALYZE_REQUEST) return
      const req = payload as { reqId: number }
      setTimeout(() => bus.emit(PF_IPC.ANALYZE_RESULT, senderEvent(34), {
        reqId: req.reqId, ok: false, message: 'model crashed',
      }), 0)
    }
    const out = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* makeModelHost(deps)
      return yield* Effect.either(host.analyze('x'))
    })))
    expect(out._tag).toBe('Left')
    if (out._tag === 'Left') {
      expect(String(out.left.cause)).toBe('model crashed')
    }
  })
})

interface FakeWindowWithSender extends FakeWindow {
  webContents: BrowserWindow['webContents'] & {
    sendImpl?: (channel: string, payload: unknown) => void
  }
}

/** Like fakeBrowserWindow but with a stub `webContents.send` so tests
 *  can react when ModelHost posts an analyze request. */
function fakeBrowserWindowWithSender(id: number): FakeWindowWithSender {
  // Reuse the EventEmitter-backed webContents so the host's
  // `render-process-gone` listener attaches, then layer on send.
  const w = fakeBrowserWindow(id) as unknown as FakeWindowWithSender
  const wc = w.webContents as FakeWindowWithSender['webContents']
  ;(wc as unknown as { send: (channel: string, payload: unknown) => void }).send =
    (channel: string, payload: unknown) => { wc.sendImpl?.(channel, payload) }
  return w
}
