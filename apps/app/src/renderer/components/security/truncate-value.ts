/** Single-line truncation for finding-value previews. 56-char ceiling
 *  matches the bulk-purge modal sample column + PurgeConfirmDialog
 *  before-text — one helper, one source of truth for the magic number. */
export function truncateValue(v: string): string {
  return v.length > 56 ? v.slice(0, 54) + '…' : v
}
