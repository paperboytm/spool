import { HIGH_SEVERITY_KINDS, detectSensitiveSpans } from '@spool-lab/redact'

// Pre-share honesty gate: sharing is sharing the full transcript, and
// transcripts carry secrets. This never blocks silently — it summarizes
// and asks (— or is bypassed explicitly with --yes).

export interface RedactGateSummary {
  total: number
  high: number
  byKind: [string, number][]
}

export function scanRecordsForSecrets(recordBodies: readonly string[]): RedactGateSummary {
  const counts = new Map<string, number>()
  let high = 0
  for (const body of recordBodies) {
    for (const match of detectSensitiveSpans(body)) {
      counts.set(match.kind, (counts.get(match.kind) ?? 0) + 1)
      if ((HIGH_SEVERITY_KINDS as ReadonlySet<string>).has(match.kind)) high += 1
    }
  }
  const byKind = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return {
    total: byKind.reduce((sum, [, count]) => sum + count, 0),
    high,
    byKind,
  }
}

export function formatRedactSummary(summary: RedactGateSummary): string {
  const lines = [
    `Potential secrets detected in this session: ${summary.total} finding(s), ${summary.high} high-severity.`,
  ]
  for (const [kind, count] of summary.byKind.slice(0, 10)) {
    lines.push(`  - ${kind}: ${count}`)
  }
  lines.push('Sharing publishes the full transcript, including these values.')
  return lines.join('\n')
}
