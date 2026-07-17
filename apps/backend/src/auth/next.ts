export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/'
  // Re-run the same shape checks on the percent-decoded value so a
  // crafted `/%2Fevil.com` (decodes to `//evil.com`) can't slip past
  // the raw `startsWith('//')` guard and produce a protocol-relative
  // Location header. decodeURIComponent throws on malformed sequences
  // — treat that as "untrusted" and fall back to "/".
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return '/'
  }
  for (const v of [raw, decoded]) {
    if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return '/'
    if (v.split('/').some((seg) => seg === '..')) return '/'
  }
  return raw
}
