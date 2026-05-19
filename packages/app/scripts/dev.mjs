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
import { resolveSpoolDataDir } from './lib/spool-data-dir.mjs'

const { value, source } = resolveSpoolDataDir(process.env)
process.env.SPOOL_DATA_DIR = value
console.log(`[dev] SPOOL_DATA_DIR=${value}${source === 'env' ? ' (inherited)' : ''}`)

const child = spawn('electron-vite', ['dev'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
})

const forward = (sig) => () => {
  if (!child.killed) child.kill(sig)
}
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
