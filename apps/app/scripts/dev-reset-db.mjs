#!/usr/bin/env node
// Remove the dev SPOOL_DATA_DIR so the next `pnpm dev` launch starts from
// an empty database. Refuses to touch a non-directory path. No-op if the
// directory doesn't exist.

import { rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = process.env.SPOOL_DATA_DIR ?? join(homedir(), '.spool-dev')

try {
  const s = await stat(dir)
  if (!s.isDirectory()) {
    console.error(`✗ ${dir} is not a directory; refusing to remove.`)
    process.exit(1)
  }
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log(`No dev DB at ${dir} — nothing to reset.`)
    process.exit(0)
  }
  throw err
}

await rm(dir, { recursive: true, force: true })
console.log(`✓ Removed ${dir}.`)
console.log(`  Next \`pnpm dev\` will start with an empty database.`)
