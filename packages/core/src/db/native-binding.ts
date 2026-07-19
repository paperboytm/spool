import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import Database from 'better-sqlite3'

export interface NativeRuntime {
  platform: string
  arch: string
  modules: string
}

interface NativeBindingLookup {
  packageDir: string
  runtime: NativeRuntime
  exists: (path: string) => boolean
}

const require = createRequire(import.meta.url)

function defaultLookup(): NativeBindingLookup {
  return {
    packageDir: dirname(require.resolve('better-sqlite3/package.json')),
    runtime: {
      platform: process.platform,
      arch: process.arch,
      modules: process.versions.modules,
    },
    exists: existsSync,
  }
}

export function nativeBindingPath(packageDir: string, runtime: NativeRuntime): string {
  return join(
    packageDir,
    'bin',
    `${runtime.platform}-${runtime.arch}-${runtime.modules}`,
    'better-sqlite3.node',
  )
}

export function nativeBindingOptions(
  options: Database.Options = {},
  lookup: NativeBindingLookup = defaultLookup(),
): Database.Options {
  const candidate = nativeBindingPath(lookup.packageDir, lookup.runtime)
  return lookup.exists(candidate) ? { ...options, nativeBinding: candidate } : options
}

/**
 * Opens SQLite with a runtime-specific native addon when one has been cached.
 * Node and Electron use different module ABIs, so relying on the package's
 * mutable build/Release file makes one runtime overwrite the other.
 */
export function openDatabase(
  filename: string | Buffer,
  options: Database.Options = {},
): Database.Database {
  return new Database(filename, nativeBindingOptions(options))
}
