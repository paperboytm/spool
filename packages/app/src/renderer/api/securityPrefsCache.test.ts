import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SecurityPreferences } from '../../preload/index.js'

const setPrefs = vi.fn()

vi.mock('./security.js', () => ({
  securityApi: {
    setPrefs: (patch: Partial<SecurityPreferences>) => setPrefs(patch),
    getPrefs: vi.fn(),
    onPrefsChanged: vi.fn(),
  },
}))

import {
  patchSecurityPrefs,
  __resetSecurityPrefsCacheForTest,
  __pushAuthoritativePrefsForTest,
  __readCacheForTest as readCache,
  __subscribeForTest as subscribe,
} from './securityPrefsCache.js'

const base: SecurityPreferences = {
  kindAllowlist: [],
  infoDefaultVisible: false,
  rescanAfterSync: 'auto',
  securityPageValuesBlurred: false,
  findingsStripValuesBlurred: false,
  pfEnabled: false,
  pfCalloutDismissed: false,
  pfActivationPending: false,
}

describe('patchSecurityPrefs optimistic update', () => {
  beforeEach(() => {
    setPrefs.mockReset()
    __resetSecurityPrefsCacheForTest(base)
  })

  it('persists the optimistic value on IPC success', async () => {
    setPrefs.mockResolvedValueOnce(undefined)
    await patchSecurityPrefs({ pfEnabled: true })
    expect(setPrefs).toHaveBeenCalledWith({ pfEnabled: true })
    expect(readCache()).toMatchObject({ pfEnabled: true })
  })

  it('reverts the cache and notifies subscribers on IPC rejection', async () => {
    let notifications = 0
    const unsub = subscribe(() => { notifications += 1 })
    setPrefs.mockRejectedValueOnce(new Error('ipc down'))
    await patchSecurityPrefs({ pfEnabled: true })
    // optimistic apply (1) + rollback (1) = 2 emits
    expect(notifications).toBe(2)
    expect(readCache()).toMatchObject({ pfEnabled: false })
    unsub()
  })

  it('does not clobber a newer authoritative value that landed during the in-flight IPC', async () => {
    let rejectIpc: (e: unknown) => void = () => {}
    setPrefs.mockImplementationOnce(
      () => new Promise((_res, rej) => { rejectIpc = rej }),
    )
    const p = patchSecurityPrefs({ pfEnabled: true })
    // Authoritative broadcast lands while setPrefs is still pending.
    __pushAuthoritativePrefsForTest({ ...base, pfEnabled: true, rescanAfterSync: 'manual' })
    // Now the IPC rejects — the stale snapshot must NOT overwrite the newer truth.
    rejectIpc(new Error('ipc down'))
    await p
    expect(readCache()).toMatchObject({ pfEnabled: true, rescanAfterSync: 'manual' })
  })

  it('cold cache: persists without optimistic write or rollback', async () => {
    __resetSecurityPrefsCacheForTest(null)
    setPrefs.mockRejectedValueOnce(new Error('ipc down'))
    await patchSecurityPrefs({ pfEnabled: true })
    expect(setPrefs).toHaveBeenCalledWith({ pfEnabled: true })
    expect(readCache()).toBeNull()
  })
})
