import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { nativeBindingOptions, nativeBindingPath } from './native-binding'

describe('better-sqlite3 native binding selection', () => {
  it('keys cached binaries by platform, architecture, and module ABI', () => {
    expect(
      nativeBindingPath('/deps/better-sqlite3', {
        platform: 'darwin',
        arch: 'arm64',
        modules: '148',
      }),
    ).toBe(join('/deps/better-sqlite3', 'bin', 'darwin-arm64-148', 'better-sqlite3.node'))
  })

  it('selects an existing runtime cache without discarding database options', () => {
    const packageDir = '/deps/better-sqlite3'
    const expected = nativeBindingPath(packageDir, {
      platform: 'darwin',
      arch: 'arm64',
      modules: '137',
    })

    expect(
      nativeBindingOptions(
        { readonly: true },
        {
          packageDir,
          runtime: { platform: 'darwin', arch: 'arm64', modules: '137' },
          exists: (path) => path === expected,
        },
      ),
    ).toEqual({ readonly: true, nativeBinding: expected })
  })

  it('falls back to the package default when no runtime cache exists', () => {
    expect(
      nativeBindingOptions(
        { fileMustExist: true },
        {
          packageDir: '/deps/better-sqlite3',
          runtime: { platform: 'linux', arch: 'x64', modules: '127' },
          exists: () => false,
        },
      ),
    ).toEqual({ fileMustExist: true })
  })
})
