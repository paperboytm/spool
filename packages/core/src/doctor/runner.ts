import { allChecks } from './checks/index.js'
import type { Check, CheckResult } from './types.js'

/**
 * Run every check (or a filtered subset by id). Each check is isolated:
 * a thrown error is converted into an `error` result so one bad check
 * cannot mask the rest of the report.
 *
 * Checks are run sequentially — they share filesystem state and a few
 * (read-only) sqlite connections, and parallelism would buy almost nothing.
 */
export async function runChecks(filterIds?: readonly string[]): Promise<CheckResult[]> {
  const selected =
    filterIds && filterIds.length > 0
      ? allChecks.filter((c) => filterIds.includes(c.id))
      : allChecks
  const results: CheckResult[] = []
  for (const check of selected) {
    results.push(await runOne(check))
  }
  return results
}

async function runOne(check: Check): Promise<CheckResult> {
  try {
    return await check.run()
  } catch (err) {
    return {
      id: check.id,
      category: check.category,
      title: check.title,
      severity: 'error',
      message: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function listChecks(): Array<Pick<Check, 'id' | 'category' | 'title'>> {
  return allChecks.map(({ id, category, title }) => ({ id, category, title }))
}
