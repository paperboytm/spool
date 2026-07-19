import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const corePackageDir = join(scriptDir, '..', 'packages', 'core')
const requireFromCore = createRequire(join(corePackageDir, 'package.json'))

export function betterSqlitePackageDir() {
  return dirname(requireFromCore.resolve('better-sqlite3/package.json'))
}

export function nativeBindingCachePath({
  platform = process.platform,
  arch = process.arch,
  modules = process.versions.modules,
} = {}) {
  return join(
    betterSqlitePackageDir(),
    'bin',
    `${platform}-${arch}-${modules}`,
    'better-sqlite3.node',
  )
}

export function cacheCurrentNativeBuild(runtime = {}) {
  const packageDir = betterSqlitePackageDir()
  const source = join(packageDir, 'build', 'Release', 'better_sqlite3.node')
  if (!existsSync(source)) throw new Error(`better-sqlite3 build output is missing: ${source}`)

  const destination = nativeBindingCachePath(runtime)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  return destination
}

export function nativeBindingIsUsable(path = nativeBindingCachePath()) {
  if (!existsSync(path)) return false
  try {
    const Database = requireFromCore('better-sqlite3')
    const db = new Database(':memory:', { nativeBinding: path })
    db.prepare('SELECT 1').get()
    db.close()
    return true
  } catch {
    return false
  }
}
