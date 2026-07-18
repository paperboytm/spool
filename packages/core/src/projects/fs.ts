import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import type { IdentityFs } from './identity.js'

export const realFs: IdentityFs = {
  exists: existsSync,
  readText: (p) => {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      return null
    }
  },
  spawn: (cmd, args, opts) => {
    // 5s timeout: a hung `git config` (e.g. ssh-agent passphrase prompt,
    // network-mounted repo) must not block session indexing.
    const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: 'utf8', timeout: 5000 })
    return { stdout: r.stdout ?? '', exitCode: r.status ?? 1 }
  },
}
