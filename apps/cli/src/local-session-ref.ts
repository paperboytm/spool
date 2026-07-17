import type { getDB } from '@spool-lab/core'

/** Expand a local session UUID prefix, rejecting ambiguous matches. */
export function expandLocalSessionUuid(db: ReturnType<typeof getDB>, input: string): string {
  const rows = db.prepare(
    'SELECT session_uuid FROM sessions WHERE session_uuid LIKE ? ORDER BY ended_at DESC LIMIT 3',
  ).all(`${input}%`) as Array<{ session_uuid: string }>

  if (rows.length === 0) return input // Let the command report its normal not-found error.
  if (rows.length > 1 && rows[0]?.session_uuid !== input) {
    throw new Error(
      `Ambiguous session id prefix ${input} — matches ${rows.map((row) => row.session_uuid).join(', ')}${rows.length === 3 ? ', …' : ''}. Use more characters.`,
    )
  }
  return rows[0]?.session_uuid ?? input
}
