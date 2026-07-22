import { describe, expect, it, vi } from 'vite-plus/test'

import { createTextUi } from '../ui.js'
import { handleDefaultCommand } from './default.js'

describe('bare spool command', () => {
  it('refreshes the index and shares without repeating login', async () => {
    const steps: string[] = []

    await expect(
      handleDefaultCommand({
        ui: createTextUi(),
        sync: () => {
          steps.push('sync')
          return 0
        },
        isLoggedIn: () => true,
        login: vi.fn(async () => 0),
        share: async () => {
          steps.push('share')
          return 0
        },
      }),
    ).resolves.toBe(0)

    expect(steps).toEqual(['sync', 'share'])
  })

  it('runs the one-time login before sharing when credentials are missing', async () => {
    const steps: string[] = []

    await expect(
      handleDefaultCommand({
        ui: createTextUi(),
        sync: () => {
          steps.push('sync')
          return 0
        },
        isLoggedIn: () => false,
        login: async () => {
          steps.push('login')
          return 0
        },
        share: async () => {
          steps.push('share')
          return 0
        },
      }),
    ).resolves.toBe(0)

    expect(steps).toEqual(['sync', 'login', 'share'])
  })

  it.each([
    ['sync', 1, ['sync']],
    ['login', 0, ['sync', 'login']],
  ] as const)('stops when %s fails', async (failure, syncExit, expectedSteps) => {
    const steps: string[] = []

    await expect(
      handleDefaultCommand({
        ui: createTextUi(),
        sync: () => {
          steps.push('sync')
          return syncExit
        },
        isLoggedIn: () => false,
        login: async () => {
          steps.push('login')
          return failure === 'login' ? 1 : 0
        },
        share: async () => {
          steps.push('share')
          return 0
        },
      }),
    ).resolves.toBe(1)

    expect(steps).toEqual(expectedSteps)
  })

  it('reports an unreadable credential state without starting login or share', async () => {
    const ui = createTextUi()
    const error = vi.spyOn(ui, 'error')
    const login = vi.fn(async () => 0 as const)
    const share = vi.fn(async () => 0 as const)

    await expect(
      handleDefaultCommand({
        ui,
        sync: () => 0,
        isLoggedIn: () => {
          throw new Error('Invalid hub credentials')
        },
        login,
        share,
      }),
    ).resolves.toBe(1)

    expect(error).toHaveBeenCalledWith('Invalid hub credentials')
    expect(login).not.toHaveBeenCalled()
    expect(share).not.toHaveBeenCalled()
  })

  it('returns the share failure exit code', async () => {
    await expect(
      handleDefaultCommand({
        ui: createTextUi(),
        sync: () => 0,
        isLoggedIn: () => true,
        share: async () => 1,
      }),
    ).resolves.toBe(1)
  })
})
