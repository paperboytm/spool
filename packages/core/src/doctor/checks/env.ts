import { accessSync, constants, mkdirSync, statfsSync } from 'node:fs'
import { homedir } from 'node:os'

import { SPOOL_DIR } from '../../db/db.js'
import type { Check, CheckResult } from '../types.js'

const MIN_NODE_MAJOR = 20
const MIN_FREE_BYTES = 1 * 1024 * 1024 * 1024 // 1 GB

export const envChecks: Check[] = [
  {
    id: 'env.node-version',
    category: 'env',
    title: 'Node.js version',
    run: (): CheckResult => {
      const v = process.versions.node
      const major = Number(v.split('.')[0])
      if (Number.isNaN(major)) {
        return mk(
          'env.node-version',
          'Node.js version',
          'warn',
          `Could not parse Node version (${v})`,
          { version: v },
        )
      }
      if (major < MIN_NODE_MAJOR) {
        return mk(
          'env.node-version',
          'Node.js version',
          'error',
          `Node ${v} is below the minimum supported (≥${MIN_NODE_MAJOR})`,
          { version: v, minMajor: MIN_NODE_MAJOR },
        )
      }
      return mk('env.node-version', 'Node.js version', 'ok', v, { version: v })
    },
  },
  {
    id: 'env.spool-dir',
    category: 'env',
    title: 'Spool home directory',
    run: (): CheckResult => {
      const dir = SPOOL_DIR
      const overrideActive = process.env['SPOOL_DATA_DIR'] !== undefined
      const defaultDir = `${homedir()}/.spool`
      try {
        mkdirSync(dir, { recursive: true })
        accessSync(dir, constants.W_OK)
        return mk('env.spool-dir', 'Spool home directory', 'ok', dir, {
          path: dir,
          overrideActive,
          defaultDir,
        })
      } catch (err) {
        return mk(
          'env.spool-dir',
          'Spool home directory',
          'error',
          `Cannot write to ${dir}: ${(err as Error).message}`,
          { path: dir, overrideActive, defaultDir },
        )
      }
    },
  },
  {
    id: 'env.disk-space',
    category: 'env',
    title: 'Disk space',
    run: (): CheckResult => {
      try {
        const stat = statfsSync(SPOOL_DIR)
        const free = Number(stat.bavail) * Number(stat.bsize)
        const ok = free >= MIN_FREE_BYTES
        return mk(
          'env.disk-space',
          'Disk space',
          ok ? 'ok' : 'warn',
          `${humanBytes(free)} free on ${SPOOL_DIR}`,
          { freeBytes: free, minFreeBytes: MIN_FREE_BYTES },
        )
      } catch (err) {
        return mk(
          'env.disk-space',
          'Disk space',
          'warn',
          `Could not stat filesystem: ${(err as Error).message}`,
        )
      }
    },
  },
]

function mk(
  id: string,
  title: string,
  severity: CheckResult['severity'],
  message: string,
  details?: Record<string, unknown>,
): CheckResult {
  return { id, category: 'env', title, severity, message, ...(details ? { details } : {}) }
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}
