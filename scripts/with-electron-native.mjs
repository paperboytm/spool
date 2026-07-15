import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'
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

let activeChild
let receivedSignal

const signalHandlers = new Map(
  ['SIGHUP', 'SIGINT', 'SIGTERM'].map((signal) => [
    signal,
    () => {
      receivedSignal ??= signal
      if (activeChild?.exitCode === null && activeChild.signalCode === null) {
        activeChild.kill(signal)
      }
    },
  ]),
)

for (const [signal, handler] of signalHandlers) {
  process.on(signal, handler)
}

function run(program, programArgs, cwd = repoRoot) {
  return new Promise((resolve) => {
    const child = spawn(program, programArgs, {
      cwd,
      env: process.env,
      stdio: 'inherit',
    })
    activeChild = child

    child.once('error', (error) => {
      console.error(`[with-electron-native] failed to start ${program}:`, error)
    })
    child.once('close', (status, signal) => {
      if (activeChild === child) activeChild = undefined
      resolve({ status, signal })
    })
  })
}

let commandResult = { status: 1, signal: null }
let restoreResult
try {
  const electronRebuild = await run(pnpmBin, [
    '--filter',
    '@spool/app',
    'exec',
    'electron-rebuild',
    '-f',
    '-w',
    'better-sqlite3',
  ])

  if (electronRebuild.status === 0 && electronRebuild.signal === null) {
    commandResult = await run(command, args, process.cwd())
  } else {
    commandResult = electronRebuild
  }
} finally {
  restoreResult = await run(process.execPath, [join(scriptDir, 'rebuild-better-sqlite3-node.mjs')])
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler)
  }

  if (restoreResult.status !== 0 || restoreResult.signal !== null) {
    console.error('[with-electron-native] failed to restore the Node ABI')
  }
}

const restoreFailed = restoreResult.status !== 0 || restoreResult.signal !== null
const exitSignal = receivedSignal ?? commandResult.signal ?? restoreResult.signal
const signalNumber = exitSignal ? osConstants.signals[exitSignal] : undefined
const exitStatus = restoreFailed
  ? (restoreResult.status ?? (signalNumber ? 128 + signalNumber : 1))
  : signalNumber
    ? 128 + signalNumber
    : (commandResult.status ?? 1)

process.exit(exitStatus)
