import { Command } from 'commander'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChecks, type CheckResult, type FixResult } from '@spool-lab/core'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface DoctorFlags {
  verbose?: boolean
  json?: boolean
  fix?: boolean
  force?: boolean
}

export const doctorCommand = new Command('doctor')
  .description('Diagnose your Spool environment, database, and config files')
  .argument('[checkId]', 'Run only a single check, e.g. `spool doctor db.integrity`')
  .option('-v, --verbose', 'Show raw details for each check')
  .option('--json', 'Print machine-readable output')
  .option('--fix', 'Apply safe fixes for any failing checks')
  .option('--force', 'With --fix, also apply destructive fixes')
  .action(async (checkId: string | undefined, flags: DoctorFlags) => {
    const filter = checkId ? [checkId] : undefined
    const rawResults = await runChecks(filter)
    const results = refineForAppVersion(rawResults, readCliVersion(), readAppVersion())

    if (flags.json) {
      printJson(results)
      setExit(results)
      return
    }

    printHuman(results, flags.verbose === true)

    if (flags.fix) {
      const applied = await applyFixes(results, flags.force === true)
      printFixSummary(applied)
      if (applied.applied.length > 0) {
        console.log('\nRe-run `spool doctor` to verify.')
      }
    } else {
      printFixHint(results)
    }

    setExit(results)
  })

/* ── output: json ─────────────────────────────────────────────────────── */

function printJson(results: CheckResult[]): void {
  const cliVersion = readCliVersion()
  const out = {
    cli: { version: cliVersion },
    app: readAppVersion(),
    results: results.map(r => ({
      id: r.id,
      category: r.category,
      title: r.title,
      severity: r.severity,
      message: r.message,
      hasFix: r.fix !== undefined,
      destructiveFix: r.fix?.destructive ?? false,
      details: r.details,
    })),
    summary: summarize(results),
  }
  console.log(JSON.stringify(out, null, 2))
}

/* ── output: human ────────────────────────────────────────────────────── */

const ICONS = { ok: '✓', warn: '⚠', error: '✗' } as const
const COLORS = {
  ok: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m',
  dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m',
} as const

const useColor = process.stdout.isTTY && process.env['NO_COLOR'] === undefined
function c(code: keyof typeof COLORS, s: string): string {
  return useColor ? `${COLORS[code]}${s}${COLORS.reset}` : s
}

const CATEGORY_ORDER: CheckResult['category'][] = ['env', 'versions', 'db', 'config', 'native']
const CATEGORY_LABEL: Record<CheckResult['category'], string> = {
  env: 'Environment',
  versions: 'Versions',
  db: 'Database',
  config: 'Config',
  native: 'Native',
}

function printHuman(results: CheckResult[], verbose: boolean): void {
  const cliVersion = readCliVersion()
  const app = readAppVersion()
  console.log(c('bold', `Spool Doctor`) + c('dim', `  cli ${cliVersion}` + (app ? `  ·  app ${app.version}` : '')))
  console.log()

  for (const category of CATEGORY_ORDER) {
    const rows = results.filter(r => r.category === category)
    if (rows.length === 0) continue
    console.log(c('bold', CATEGORY_LABEL[category] ?? category))
    for (const r of rows) {
      const icon = c(r.severity, ICONS[r.severity])
      console.log(`  ${icon} ${r.title.padEnd(32)} ${r.message}`)
      if (r.fix) {
        const tag = r.fix.destructive ? c('warn', '[destructive]') : c('dim', '[safe]')
        console.log(`      ${c('dim', '→ fix:')} ${r.fix.description}  ${tag}`)
      }
      if (verbose && r.details && Object.keys(r.details).length > 0) {
        for (const [k, v] of Object.entries(r.details)) {
          console.log(c('dim', `      · ${k}: ${formatDetail(v)}`))
        }
      }
    }
    console.log()
  }

  const sum = summarize(results)
  console.log(
    `Summary: ${c('ok', `${sum.ok} ok`)} · ${c('warn', `${sum.warn} warn`)} · ${c('error', `${sum.error} error`)}`,
  )
}

function printFixHint(results: CheckResult[]): void {
  const safe = results.filter(r => r.fix && !r.fix.destructive).length
  const destructive = results.filter(r => r.fix && r.fix.destructive).length
  if (safe === 0 && destructive === 0) return
  const parts: string[] = []
  if (safe > 0) parts.push(`${safe} safe`)
  if (destructive > 0) parts.push(`${destructive} destructive (needs --force)`)
  console.log()
  console.log(c('dim', `Run \`spool doctor --fix\` to apply automatic fixes (${parts.join(', ')}).`))
}

/* ── fix application ──────────────────────────────────────────────────── */

interface FixOutcome {
  id: string
  description: string
  destructive: boolean
  result: FixResult
}

interface FixSummary {
  applied: FixOutcome[]
  skipped: Array<{ id: string; reason: string }>
}

async function applyFixes(results: CheckResult[], force: boolean): Promise<FixSummary> {
  const applied: FixOutcome[] = []
  const skipped: Array<{ id: string; reason: string }> = []

  for (const r of results) {
    if (!r.fix) continue
    if (r.fix.destructive && !force) {
      skipped.push({ id: r.id, reason: 'destructive — needs --force' })
      continue
    }
    try {
      const result = await r.fix.apply()
      applied.push({ id: r.id, description: r.fix.description, destructive: r.fix.destructive, result })
    } catch (err) {
      applied.push({
        id: r.id, description: r.fix.description, destructive: r.fix.destructive,
        result: { ok: false, message: `Threw: ${err instanceof Error ? err.message : String(err)}` },
      })
    }
  }
  return { applied, skipped }
}

function printFixSummary(summary: FixSummary): void {
  if (summary.applied.length === 0 && summary.skipped.length === 0) {
    console.log()
    console.log(c('dim', 'No fixes to apply.'))
    return
  }

  console.log()
  console.log(c('bold', 'Fixes'))
  for (const o of summary.applied) {
    const icon = o.result.ok ? c('ok', ICONS.ok) : c('error', ICONS.error)
    const tag = o.destructive ? c('warn', '[destructive]') : c('dim', '[safe]')
    console.log(`  ${icon} ${o.id.padEnd(32)} ${o.result.message}  ${tag}`)
  }
  for (const s of summary.skipped) {
    console.log(`  ${c('dim', '–')} ${s.id.padEnd(32)} ${c('dim', s.reason)}`)
  }
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function summarize(results: CheckResult[]): { ok: number; warn: number; error: number } {
  return {
    ok: results.filter(r => r.severity === 'ok').length,
    warn: results.filter(r => r.severity === 'warn').length,
    error: results.filter(r => r.severity === 'error').length,
  }
}

function setExit(results: CheckResult[]): void {
  if (results.some(r => r.severity === 'error')) {
    process.exitCode = 1
  }
}

function readCliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }
    return pkg.version
  } catch {
    return 'unknown'
  }
}

function readAppVersion(): { version: string; path: string } | null {
  if (process.platform !== 'darwin') return null
  const plistPath = '/Applications/Spool.app/Contents/Info.plist'
  if (!existsSync(plistPath)) return null
  try {
    const raw = readFileSync(plistPath, 'utf8')
    const match = raw.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)
    if (!match || !match[1]) return null
    return { version: match[1], path: '/Applications/Spool.app' }
  } catch {
    return null
  }
}

/**
 * Compare two semver-ish strings ("1.2.3", "1.2.3-rc.4"). Returns negative if
 * a < b, 0 if equal, positive if a > b. Pre-release/build suffix is ignored;
 * any non-numeric segment becomes 0.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string) =>
    s.split(/[-+]/)[0]!.split('.').map(n => parseInt(n, 10) || 0)
  const av = parse(a)
  const bv = parse(b)
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * When the CLI is ahead of the installed Spool.app, running the
 * `versions.schema-compat` migrate fix would push the DB to a schema the
 * installed app can no longer open. Reframe the message to recommend upgrading
 * the app first, and mark the fix as destructive so `--fix` alone skips it
 * (`--fix --force` still works as an escape hatch for users who know what
 * they're doing).
 */
export function refineForAppVersion(
  results: CheckResult[],
  cliVersion: string,
  app: { version: string; path: string } | null,
): CheckResult[] {
  if (!app || cliVersion === 'unknown') return results
  if (compareSemver(cliVersion, app.version) <= 0) return results
  return results.map(r => {
    if (r.id !== 'versions.schema-compat' || !r.fix) return r
    return {
      ...r,
      message:
        `${r.message} — Spool.app is ${app.version}, older than this CLI ${cliVersion}`,
      fix: {
        ...r.fix,
        description:
          `Upgrade Spool.app to ${cliVersion} first, then re-run. ` +
          `Migrating now would leave the installed app unable to open the database. ` +
          `--fix --force overrides this guard if you know what you're doing.`,
        destructive: true,
      },
    }
  })
}

function formatDetail(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}
