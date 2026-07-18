import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corePackageDir = join(__dirname, '..', 'packages', 'core')
const requireFromCore = createRequire(join(corePackageDir, 'package.json'))

const packageJsonPath = requireFromCore.resolve('better-sqlite3/package.json')
const packageDir = dirname(packageJsonPath)
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'

console.log(`[rebuild-better-sqlite3-node] rebuilding in ${packageDir}`)

const result = spawnSync(npmBin, ['run', 'build-release'], {
  cwd: packageDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_runtime: 'node',
    npm_config_target: process.versions.node,
  },
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
