import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { nativeBindingCachePath, nativeBindingIsUsable } from './better-sqlite3-native.mjs'

const cachedBinding = nativeBindingCachePath()
if (!nativeBindingIsUsable(cachedBinding)) {
  console.log(
    `[ensure-better-sqlite3-node] preparing ${process.platform}-${process.arch} ABI ${process.versions.modules}`,
  )
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const result = spawnSync(process.execPath, [join(scriptDir, 'rebuild-better-sqlite3-node.mjs')], {
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
