#!/usr/bin/env node
// Wrapper for `electron-vite dev` that isolates Spool's data directory.
//
// pnpm dev must NOT touch the user's real ~/.spool/. Electron's main
// process bundle reads SPOOL_DATA_DIR from process.env at module load,
// so the env var has to be set BEFORE Electron starts — i.e. here in
// the launcher, not inside the bundled code. (A previous attempt with
// a side-effect import was reordered by Rollup behind the
// @spool-lab/core chunk require, silently routing dev writes to the
// production DB. Don't do that.)

import { spawn } from 'node:child_process'

import { DEV_LAUNCH_PLAN } from './lib/dev-launch-plan.mjs'
import { resolveSpoolDataDir } from './lib/spool-data-dir.mjs'

const { value, source } = resolveSpoolDataDir(process.env)
process.env.SPOOL_DATA_DIR = value
console.log(`[dev] SPOOL_DATA_DIR=${value}${source === 'env' ? ' (inherited)' : ''}`)

let child = null
const forward = (signal) => () => {
  if (child && !child.killed) child.kill(signal)
}
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))

function runStep(step) {
  console.log(`[dev] Starting ${step.label}`)
  return new Promise((resolve) => {
    child = spawn(step.command, step.args, {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    })
    child.on('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function main() {
  for (const step of DEV_LAUNCH_PLAN) {
    const { code, signal } = await runStep(step)
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    if (code !== 0) {
      process.exitCode = code ?? 1
      return
    }
  }
}

void main()
