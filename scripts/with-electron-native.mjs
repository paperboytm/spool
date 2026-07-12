import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, '..')
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const command = process.argv[2]
const args = process.argv.slice(3)

if (!command) {
  console.error('Usage: with-electron-native.mjs <command> [...args]')
  process.exit(2)
}

function run(program, programArgs, cwd = repoRoot) {
  return spawnSync(program, programArgs, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  })
}

let commandStatus = 1
try {
  const electronRebuild = run(pnpmBin, [
    '--filter',
    '@spool/app',
    'exec',
    'electron-rebuild',
    '-f',
    '-w',
    'better-sqlite3',
  ])

  if (electronRebuild.status === 0) {
    const result = run(command, args, process.cwd())
    commandStatus = result.status ?? 1
  } else {
    commandStatus = electronRebuild.status ?? 1
  }
} finally {
  const restore = run(process.execPath, [join(scriptDir, 'rebuild-better-sqlite3-node.mjs')])
  if (restore.status !== 0) {
    console.error('[with-electron-native] failed to restore the Node ABI')
    commandStatus = restore.status ?? 1
  }
}

process.exit(commandStatus)
