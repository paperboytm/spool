import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SPOOL_DIR } from '../../db/db.js'
import type { Category, Check, CheckResult } from '../types.js'

interface ConfigFile {
  id: string
  filename: string
  required: boolean
  validate?: (parsed: unknown) => string | null
}

const FILES: ConfigFile[] = [
  {
    id: 'config.agents',
    filename: 'agents.json',
    required: false,
    validate: (parsed) => {
      if (parsed === null || typeof parsed !== 'object') return 'expected JSON object'
      return null
    },
  },
  {
    id: 'config.ui',
    filename: 'ui.json',
    required: false,
    validate: (parsed) => {
      if (parsed === null || typeof parsed !== 'object') return 'expected JSON object'
      return null
    },
  },
  {
    id: 'config.registry-cache',
    filename: 'registry-cache.json',
    required: false,
  },
]

export const configChecks: Check[] = FILES.map((file) => ({
  id: file.id,
  category: 'config' as Category,
  title: file.filename,
  run: (): CheckResult => checkConfigFile(file),
}))

function checkConfigFile(file: ConfigFile): CheckResult {
  const path = join(SPOOL_DIR, file.filename)
  const base = {
    id: file.id,
    category: 'config' as Category,
    title: file.filename,
  }

  if (!existsSync(path)) {
    return {
      ...base,
      severity: file.required ? 'error' : 'ok',
      message: file.required ? `Missing at ${path}` : 'not present (optional)',
      details: { path },
    }
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    return {
      ...base,
      severity: 'error',
      message: `Cannot read: ${(err as Error).message}`,
      details: { path },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      ...base,
      severity: 'error',
      message: `Invalid JSON: ${(err as Error).message}`,
      details: { path, bytes: raw.length },
      fix: {
        description: `Back up corrupt ${file.filename} and reset to {}`,
        destructive: true,
        apply: () => resetConfigFile(path),
      },
    }
  }

  if (file.validate) {
    const err = file.validate(parsed)
    if (err) {
      return {
        ...base,
        severity: 'error',
        message: `Schema error: ${err}`,
        details: { path },
        fix: {
          description: `Back up malformed ${file.filename} and reset to {}`,
          destructive: true,
          apply: () => resetConfigFile(path),
        },
      }
    }
  }

  return {
    ...base,
    severity: 'ok',
    message: `valid (${humanBytes(raw.length)})`,
    details: { path, bytes: raw.length },
  }
}

function resetConfigFile(path: string): { ok: boolean; message: string } {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${path}.bak.${ts}`
  try {
    renameSync(path, backup)
  } catch (err) {
    return { ok: false, message: `Could not back up: ${(err as Error).message}` }
  }
  writeFileSync(path, '{}\n', 'utf8')
  return { ok: true, message: `Reset; previous contents at ${backup}` }
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
