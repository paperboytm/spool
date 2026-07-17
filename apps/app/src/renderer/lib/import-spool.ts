/** Content-hash draft id for an imported .spool, so re-importing the
 *  same file collapses onto the same draft row instead of forking. */
export async function draftIdForImport(snapshotJson: string): Promise<string> {
  const buf = new TextEncoder().encode(snapshotJson)
  const hash = await crypto.subtle.digest('SHA-1', buf)
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8)
  return `imported:${hex}`
}
