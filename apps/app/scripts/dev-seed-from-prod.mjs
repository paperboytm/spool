#!/usr/bin/env node
// Copy the user's real ~/.spool/ to the dev dir so dev mode has realistic
// data to test against. NOT automatic — opt in when you want it. Refuses
// to overwrite if dev dir is non-empty unless --force.

import { access, cp, mkdir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const src = join(homedir(), '.spool')
const dst = process.env.SPOOL_DATA_DIR ?? join(homedir(), '.spool-dev')
const force = process.argv.includes('--force')

try {
  await access(src)
  const srcStat = await stat(src)
  if (!srcStat.isDirectory()) {
    console.error(`✗ ${src} exists but is not a directory.`)
    process.exit(1)
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`✗ Prod dir ${src} doesn't exist. Nothing to seed from.`)
    process.exit(1)
  }
  throw err
}

try {
  const entries = await readdir(dst)
  if (entries.length > 0 && !force) {
    console.error(`✗ Dev dir ${dst} is non-empty.`)
    console.error(`  Run with --force to overwrite, or 'pnpm dev:reset-db' first.`)
    process.exit(1)
  }
} catch (err) {
  if (err.code !== 'ENOENT') throw err
  // dst doesn't exist yet — fine, mkdir below will create it
}

await mkdir(dst, { recursive: true })
await cp(src, dst, { recursive: true, force: true })
console.log(`✓ Copied ${src} → ${dst}.`)
console.log(``)
console.log(`  ⚠  This includes any sensitive data from your real sessions.`)
console.log(`     Treat the dev DB with the same care as the real one.`)
