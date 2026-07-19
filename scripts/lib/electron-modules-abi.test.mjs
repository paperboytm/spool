import { describe, expect, test } from 'vite-plus/test'

import { electronModulesAbi } from './electron-modules-abi.mjs'

describe('Electron ABI resolution', () => {
  test('uses the running Electron ABI when the runtime is available', () => {
    expect(
      electronModulesAbi({
        result: { status: 0, stdout: '148\n' },
        electronVersion: '43.1.1',
      }),
    ).toBe('148')
  })

  test('resolves the ABI from the Electron version when the runtime cannot start', () => {
    expect(
      electronModulesAbi({
        result: { status: 1, stdout: '', stderr: 'Electron failed to start' },
        electronVersion: '43.1.1',
      }),
    ).toBe('148')
  })
})
