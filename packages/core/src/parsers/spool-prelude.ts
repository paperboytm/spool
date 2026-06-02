/**
 * Spool wraps its agent-search system instructions in this marker before
 * sending them to ACP, so the parsers can strip them back out when indexing
 * the on-disk JSONL. Without the marker, our system prompt would appear as
 * the first user message in every agent-search session — polluting the
 * derived title, the FTS index, and the session detail view.
 *
 * The user's actual query is sent OUTSIDE the marker block (at the end of
 * the message text), so after stripping the prelude only the bare query
 * remains.
 */
export const SPOOL_SYSTEM_PRELUDE_OPEN = '<spool-system-prelude>'
export const SPOOL_SYSTEM_PRELUDE_CLOSE = '</spool-system-prelude>'

export function wrapSpoolSystemPrelude(systemBody: string, userQuery: string): string {
  return `${SPOOL_SYSTEM_PRELUDE_OPEN}\n${systemBody}\n${SPOOL_SYSTEM_PRELUDE_CLOSE}\n\n${userQuery}`
}

export function stripSpoolSystemPrelude(text: string): string {
  // indexOf scanning instead of a regex: the `<open>[\s\S]*?<close>` form
  // backtracks quadratically when many unterminated open markers appear in
  // hostile input. Each pass here is linear.
  let result = text
  let open = result.indexOf(SPOOL_SYSTEM_PRELUDE_OPEN)
  while (open !== -1) {
    const close = result.indexOf(SPOOL_SYSTEM_PRELUDE_CLOSE, open + SPOOL_SYSTEM_PRELUDE_OPEN.length)
    if (close === -1) break // unterminated marker — leave the remainder intact
    result = result.slice(0, open) + result.slice(close + SPOOL_SYSTEM_PRELUDE_CLOSE.length)
    open = result.indexOf(SPOOL_SYSTEM_PRELUDE_OPEN)
  }
  return result.trim()
}
