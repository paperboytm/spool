import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corePackageDir = join(__dirname, '..', 'packages', 'core')
const requireFromCore = createRequire(join(corePackageDir, 'package.json'))

const packageJsonPath = requireFromCore.resolve('better-sqlite3/package.json')
const packageDir = dirname(packageJsonPath)
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const ifNeeded = process.argv.includes('--if-needed')

if (ifNeeded) {
  try {
    const Database = requireFromCore('better-sqlite3')
    const db = new Database(':memory:')
    db.prepare('SELECT 1').get()
    db.close()
    console.log('[rebuild-better-sqlite3-node] Node ABI already matches; skipping rebuild')
    process.exit(0)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.log(`[rebuild-better-sqlite3-node] Node ABI check failed; rebuilding (${reason})`)
  }
}

console.log(`[rebuild-better-sqlite3-node] rebuilding in ${packageDir}`)

const result = spawnSync(npmBin, ['run', 'build-release'], {
  cwd: packageDir,
  stdio: 'inherit',
  env: process.env,
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
