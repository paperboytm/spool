import { beforeEach, describe, expect, it, vi } from 'vitest'

let encryptionAvailable = true

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('cannot decrypt')
      return s.slice(4)
    },
  },
}))

// In-memory stand-in for electron-store. We only need .get/.set on the keys
// session-store.ts touches. Default export to match the real package shape.
class FakeStore<T extends Record<string, unknown>> {
  private data: Record<string, unknown>
  constructor(opts: { defaults: T }) {
    this.data = { ...opts.defaults }
  }
  get<K extends keyof T>(key: K): T[K] {
    return this.data[key as string] as T[K]
  }
  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key as string] = value
  }
}

vi.mock('electron-store', () => ({ default: FakeStore }))

// Re-import after mocks so the module-level Store sees the fake.
async function loadModule() {
  vi.resetModules()
  return await import('./session-store.js')
}

describe('session-store', () => {
  beforeEach(() => {
    encryptionAvailable = true
  })

  it('round-trips a token through safeStorage + store', async () => {
    const mod = await loadModule()
    expect(mod.isAvailable()).toBe(true)
    expect(mod.loadToken()).toBe(null)
    mod.saveToken('hunter2')
    expect(mod.loadToken()).toBe('hunter2')
  })

  it('clears the token', async () => {
    const mod = await loadModule()
    mod.saveToken('t')
    mod.clearToken()
    expect(mod.loadToken()).toBe(null)
  })

  it('throws on saveToken when safeStorage unavailable', async () => {
    const mod = await loadModule()
    encryptionAvailable = false
    expect(() => mod.saveToken('x')).toThrow(/safeStorage not available/)
    expect(mod.isAvailable()).toBe(false)
  })

  it('loadToken returns null when decryption throws', async () => {
    const mod = await loadModule()
    mod.saveToken('valid')
    // Corrupt by overwriting via clear-then-set isn't trivial; instead
    // make decryptString fail on next call.
    const electron = (await import('electron')) as unknown as {
      safeStorage: { decryptString: (b: Buffer) => string }
    }
    const orig = electron.safeStorage.decryptString
    electron.safeStorage.decryptString = () => {
      throw new Error('boom')
    }
    expect(mod.loadToken()).toBe(null)
    electron.safeStorage.decryptString = orig
  })
})
