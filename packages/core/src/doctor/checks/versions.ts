import { existsSync } from 'node:fs'

import { DB_PATH, LATEST_SCHEMA_VERSION, getDB } from '../../db/db.js'
import { openDatabase } from '../../db/native-binding.js'
import { probeSqlite } from '../preflight.js'
import type { Check, CheckResult } from '../types.js'

export const versionChecks: Check[] = [
  {
    id: 'versions.schema-compat',
    category: 'versions',
    title: 'Database schema compatibility',
    run: (): CheckResult => {
      const sqlite = probeSqlite()
      if (!sqlite.ok) {
        return {
          id: 'versions.schema-compat',
          category: 'versions',
          title: 'Database schema compatibility',
          severity: 'warn',
          message: 'skipped — see `native.sqlite`',
        }
      }
      if (!existsSync(DB_PATH)) {
        return {
          id: 'versions.schema-compat',
          category: 'versions',
          title: 'Database schema compatibility',
          severity: 'ok',
          message: `No database yet — schema will be created at v${LATEST_SCHEMA_VERSION} on first sync`,
          details: { expected: LATEST_SCHEMA_VERSION },
        }
      }

      const db = openDatabase(DB_PATH, { readonly: true, fileMustExist: true })
      try {
        const row = db.pragma('user_version') as Array<{ user_version: number }>
        const current = row[0]?.user_version ?? 0

        if (current === LATEST_SCHEMA_VERSION) {
          return {
            id: 'versions.schema-compat',
            category: 'versions',
            title: 'Database schema compatibility',
            severity: 'ok',
            message: `v${current}`,
            details: { current, expected: LATEST_SCHEMA_VERSION },
          }
        }

        if (current < LATEST_SCHEMA_VERSION) {
          return {
            id: 'versions.schema-compat',
            category: 'versions',
            title: 'Database schema compatibility',
            severity: 'error',
            message: `DB is at v${current}, CLI expects v${LATEST_SCHEMA_VERSION}`,
            details: { current, expected: LATEST_SCHEMA_VERSION },
            fix: {
              description: `Migrate database from v${current} to v${LATEST_SCHEMA_VERSION}`,
              destructive: false,
              apply: () => {
                getDB()
                return { ok: true, message: `Migrated to v${LATEST_SCHEMA_VERSION}` }
              },
            },
          }
        }

        return {
          id: 'versions.schema-compat',
          category: 'versions',
          title: 'Database schema compatibility',
          severity: 'error',
          message:
            `DB is at v${current} but this CLI only knows up to v${LATEST_SCHEMA_VERSION}. ` +
            `Upgrade the CLI (npm i -g @spool-lab/cli).`,
          details: { current, expected: LATEST_SCHEMA_VERSION },
        }
      } finally {
        db.close()
      }
    },
  },
]
