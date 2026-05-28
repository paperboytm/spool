// Small validators used by the detector rules to suppress false
// positives that pure regex can't. Each is side-effect-free and
// returns boolean — discard-on-false at the detector level.
//
// Also home to `hashValueForRedactExclude`: the non-crypto hash
// used by the Share editor to record per-item opt-outs WITHOUT
// writing the literal value back to disk. See `RedactExclude` in
// `@spool/share-kit` for the threat model and rationale.

/** Luhn check for credit-card-shaped digit runs. Operates on the
 *  raw match (separators allowed); returns true if the embedded
 *  digit sequence is a valid mod-10 checksum. */
export function luhnOk(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

/** Stable 32-bit non-cryptographic hash of `value`, hex-encoded as
 *  8 lowercase characters. Used by the Share editor to persist per-
 *  item redact opt-outs in `RedactExclude.valueHashes` *without*
 *  storing the literal value.
 *
 *  Threat model: an attacker who can read the persisted draft can
 *  also read the conversation body in the same file, so a stronger
 *  hash would not raise the bar. The goal here is to ensure the
 *  Share editor itself doesn't produce a NEW on-disk artifact that
 *  names a sensitive literal. FNV-1a is deterministic, sync, and
 *  fast enough to call inside a React render. */
export function hashValueForRedactExclude(value: string): string {
  // FNV-1a 32-bit. Offset basis 0x811c9dc5, prime 0x01000193.
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    // Force back to unsigned 32-bit after each multiply so JS's
    // 53-bit-mantissa Number doesn't drift into floating-point.
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Shannon entropy of a string. Used to gate the generic-secret rule
 *  so that `password = "letmeinletmeinletmein"` (low-entropy) doesn't
 *  trigger but `password = "j82H1xK9pQrSt7VwYzA3"` does. */
export function shannon(s: string): number {
  if (!s) return 0
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  const len = s.length
  let h = 0
  for (const n of counts.values()) {
    const p = n / len
    h -= p * Math.log2(p)
  }
  return h
}

/** Curried entropy floor for use as a rule validator. The match
 *  string is expected to be a "keyword = value" capture; we pull the
 *  quoted body so we don't include the key name in the entropy. */
export function hasQuotedEntropy(min: number): (value: string) => boolean {
  return (value: string) => {
    const inner = value.match(/["']([^"']{6,})["']/)?.[1] ?? value
    return shannon(inner) >= min
  }
}

// ── Shared false-positive filters ─────────────────────────────────
//
// Every regex below is a "this string says I am NOT a real secret"
// signal — extracted into one place so per-rule validators read as a
// composition of intent ("env-var that isn't placeholder, redacted,
// or a public-prefix") instead of bespoke patchwork. Empirical: most
// scan-induced noise on real chat content is one of these four:
//   1. user manually redacted before paste (`[redacted]`, `…`)
//   2. vendor docs example (AWS `AKIAIOSFODNN7EXAMPLE`)
//   3. JS code matching the env shape (`const FOO_KEY = 'string'`)
//   4. value is a placeholder (`xxxx`, `your_token`, `password`)

/** "[redacted]" / "<redacted>" / "[SECRET:…]" / "【已隐藏】" — set by a
 *  user or an upstream tool to flag the literal was scrubbed. */
const REDACTION_MARKER_RX = /\[(?:redacted|hidden|secret|removed|masked)(?::[^\]]*)?\]|<(?:redacted|hidden)>|【已?隐藏】/i

export function containsRedactionMarker(value: string): boolean {
  return REDACTION_MARKER_RX.test(value)
}

/** Visual ellipsis (`…` or `...`) — the original value was truncated
 *  in the middle, so the substring we're holding isn't actually the
 *  secret even if the surrounding shape looks credential-like. */
export function containsEllipsis(value: string): boolean {
  return /…|\.\.\./.test(value)
}

/** Self-evidently-fake placeholder values: `xxxx-xxxx-xxxx`, repeated
 *  chars, `<your-key>`, `letmein`, `hunter2`, alphabet-sequence dumps. */
const PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp> = [
  /^[xX]+(?:[-_ ][xX]+)*$/,                                   // xxxx, xxxx-xxxx
  /^(.)\1{4,}$/,                                              // 5+ repeats: aaaaa, 00000
  /^<[a-zA-Z0-9_\-\s]+>$/,                                    // <YOUR_TOKEN>
  /\byour[_-]?(?:secret|key|token|password|api[_-]?key)\b/i,
  /\b(?:placeholder|todo|fixme|example|sample|dummy|fake|test[_-]?value)\b/i,
  /^(?:letmein|changeme|password|passwd|hunter2|123456|qwerty|abc123|admin)$/i,
  /^abcdefghijklmnopqrstuvwxyz/,                              // alphabet dumps
  /^0?123456789/,                                             // sequential digits
]

export function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((rx) => rx.test(value))
}

/** Strict union of (a) IETF/IANA reserved example/test labels and
 *  (b) generic "fake company" domains that show up constantly in
 *  documentation. Source: RFC 2606 + RFC 6761. */
const RESERVED_DOMAINS = new Set([
  'example.com', 'example.net', 'example.org', 'example.edu',
  'test.com', 'test.net', 'test.org', 'invalid', 'localhost', 'example', 'test',
  'company.com', 'mycompany.com', 'yourcompany.com', 'yourdomain.com', 'mydomain.com',
  'domain.com', 'domain.net', 'foo.com', 'bar.com', 'foobar.com',
])

export function isReservedDomain(domain: string): boolean {
  return RESERVED_DOMAINS.has(domain.toLowerCase())
}

/** macOS icon assets (`icon_16x16@2x.png`), Sketch / Figma exports,
 *  Slack emoji files — all contain `@N x` style suffixes that the
 *  email regex matches. Reject when the trailing token is a known
 *  image extension. */
export function looksLikeImageAsset(value: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|heic|avif)$/i.test(value)
}

/** Public-by-convention env-var prefixes. Frameworks intentionally
 *  bundle these to the client / commit them to repos:
 *    NEXT_PUBLIC_*, VITE_*, REACT_APP_*, NUXT_PUBLIC_*, EXPO_PUBLIC_*,
 *    GATSBY_*, VUE_APP_*, STORYBOOK_* */
const PUBLIC_ENV_PREFIX_RX = /^(?:NEXT_PUBLIC|REACT_APP|VITE|PUBLIC|VUE_APP|GATSBY|EXPO_PUBLIC|NUXT_PUBLIC|STORYBOOK)_/

export function hasPublicEnvPrefix(name: string): boolean {
  return PUBLIC_ENV_PREFIX_RX.test(name)
}

/** AWS / vendor "this is the documentation key" patterns. AWS' own
 *  IAM docs use `AKIAIOSFODNN7EXAMPLE` + `wJalrXUtnFEMI/K7MDENG/…EXAMPLEKEY`
 *  literally in every tutorial. Treat any vendor key ending in
 *  EXAMPLE / SAMPLE / DEMO / YOUR_KEY as a non-secret. */
export function isVendorExampleKey(value: string): boolean {
  return /(?:EXAMPLE|SAMPLE|DEMO|YOUR_?(?:KEY|TOKEN|SECRET)?)(?:KEY)?$/i.test(value)
}

/** Composite filter used by every text-credential rule. */
export function isObviouslyNonSecretValue(value: string): boolean {
  return containsRedactionMarker(value)
      || containsEllipsis(value)
      || looksLikePlaceholder(value)
}

/** Any non-ASCII character. Used by detectors whose regex would
 *  otherwise accept natural-language placeholder text (CJK, Cyrillic,
 *  Hangul, Arabic, emoji, …) — real secrets in those detectors are
 *  always ASCII so non-ASCII content is a placeholder description.
 *  Do NOT compose this into the shared isObviouslyNonSecretValue:
 *  connection-string / url-creds / netrc legitimately allow unicode
 *  passwords and would regress to false negatives. */
const NON_ASCII_RX = /[^\x00-\x7F]/

export function hasNonAsciiContent(value: string): boolean {
  return NON_ASCII_RX.test(value)
}

/** Non-routable / documentation IP ranges that aren't real network
 *  endpoints — loopback, RFC 5737 doc ranges, RFC 3849 IPv6 doc
 *  range, unspecified address, link-local. */
export function isReservedIp(value: string): boolean {
  // Loopback
  if (value === '127.0.0.1' || value === '::1') return true
  if (value.startsWith('127.')) return true
  // RFC 5737 IPv4 documentation
  if (value.startsWith('192.0.2.')) return true
  if (value.startsWith('198.51.100.')) return true
  if (value.startsWith('203.0.113.')) return true
  // RFC 3849 IPv6 documentation
  if (/^2001:0?db8/i.test(value)) return true
  // Unspecified / wildcard
  if (value === '0.0.0.0' || value === '::') return true
  // Link-local (RFC 3927 / RFC 4291)
  if (value.startsWith('169.254.')) return true
  if (/^fe80:/i.test(value)) return true
  return false
}
