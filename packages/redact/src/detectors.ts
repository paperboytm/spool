// Regex detection pipeline for @spool-lab/redact.
//
// Primary scenario: Spool sessions captured from local coding agents
// (Claude Code, codex, gemini) — terminal output, tool results, files
// the agent read, error logs. The patterns favour structured leaks
// that *appear in this kind of content*: a stray `cat ~/.aws/creds`
// line, `gh auth status` dumping a token, a `kubectl config view`
// pasted into the conversation, a `psql "postgresql://…"` invocation.
//
// Rule ordering matters. Wider patterns whose prefix LEAKS context
// (env-var name reveals the vendor; URL host + creds leak the host;
// connection-string scheme reveals the database type) run before
// bare vendor api-keys so the whole assignment is masked, not just
// the secret value. JWT runs before `Bearer` so a JWT-shaped bearer
// surfaces as a JWT rather than a generic bearer wrapping a JWT.

import type { SensitiveKind, SensitiveMatch } from './types.js'
import {
  containsEllipsis,
  containsRedactionMarker,
  hasNonAsciiContent,
  hasPublicEnvPrefix,
  hasQuotedEntropy,
  isObviouslyNonSecretValue,
  isReservedDomain,
  isReservedIp,
  isVendorExampleKey,
  looksLikeImageAsset,
  looksLikePlaceholder,
  luhnOk,
  shannon,
} from './validators.js'

interface Rule {
  kind: SensitiveKind
  rx: RegExp
  /** Discard the match if the validator returns false. */
  validate?: (value: string) => boolean
  /** Confidence assigned to any surviving match. */
  confidence: number
}

// ── Credential blocks (multi-line, highest specificity) ───────────

// PEM-armoured key: header + base64 body + footer. Match runs to the
// END footer (non-greedy across newlines) so the whole block — armor
// headers and all — is masked as a single unit.
const PEM_RX = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP |)PRIVATE KEY-----/g

// Raw OpenSSH private key body when a user pasted only the body
// without the BEGIN/END armour. Conservative: requires the canonical
// `b3BlbnNzaC1rZXk` magic prefix (base64 of "openssh-key") to keep
// the FP rate near zero.
const SSH_KEY_BODY_RX = /b3BlbnNzaC1rZXk[A-Za-z0-9+/=\n\r]{60,}/g

// ~/.aws/credentials INI block: starts at a `[profile]` section
// header that immediately precedes one of the canonical AWS keys,
// runs through whatever AWS settings follow until a blank line.
// Also catches `aws_access_key_id = …` lines outside an INI section
// (one-off pasted line from `aws configure`).
const AWS_INI_RX = /(?:\[[^\]\n]+\]\s*\n)?(?:aws_(?:access_key_id|secret_access_key|session_token)\s*=\s*\S+\s*\n?){1,4}/g

// gcloud INI line. `gcloud auth print-access-token` output is just a
// bare `ya29.…` token — covered by the api-key vendor list. The INI
// rule here catches `~/.config/gcloud/application_default_credentials.json`
// JSON paste where keys leak as fielded values.
const GCLOUD_JSON_RX = /"(?:refresh_token|client_secret|access_token)"\s*:\s*"[A-Za-z0-9_\-./]{20,}"/g

// kubeconfig token / cert-data fields. Either YAML or JSON shape.
// Catches `token:`, `client-certificate-data:`, `client-key-data:`,
// `id-token:`, `refresh-token:`. The value is base64 PEM or an
// opaque bearer — either way it must not ship.
const KUBECONFIG_RX = /\b(?:token|client-certificate-data|client-key-data|certificate-authority-data|id-token|refresh-token)\s*:\s*[A-Za-z0-9+/=_\-.]{20,}\b/g

// .netrc machine/login/password line — single-line shape since that's
// how it's usually pasted from a terminal.
const NETRC_RX = /\bmachine\s+\S+\s+login\s+\S+\s+password\s+\S+/g

// Database connection strings — scheme-aware, capture the whole URI
// so the host/db/user/password are all masked.
const CONN_STRING_RX = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?|amqps?|mssql|sqlserver|jdbc:[a-z]+|cassandra|clickhouse|kafka|nats):\/\/[^\s"'`<>]+/gi

// ── Single-token credentials ─────────────────────────────────────

const JWT_RX = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g

// Vendor-prefixed credentials. Order each alt so the most specific
// pattern is unambiguous — `sk-ant-` before `sk-` (with a lookahead
// on the latter to avoid double-matching Anthropic keys as OpenAI).
const VENDOR_API_KEY_RX = new RegExp(
  '\\b(?:' + [
    // Payment / SaaS
    'sk_(?:live|test)_[A-Za-z0-9]{16,}',
    'rk_(?:live|test)_[A-Za-z0-9]{16,}',
    'pk_(?:live|test)_[A-Za-z0-9]{16,}',
    // AI vendors
    'sk-ant-[A-Za-z0-9_-]{32,}',
    'sk-proj-[A-Za-z0-9_-]{32,}',
    'sk-(?!ant-|proj-)[A-Za-z0-9]{32,}',
    'hf_[A-Za-z0-9]{30,}',
    // Source forges
    'gh[pousr]_[A-Za-z0-9]{36}',
    'glpat-[A-Za-z0-9_-]{20}',
    // Cloud providers
    'AKIA[0-9A-Z]{16}',
    'ASIA[0-9A-Z]{16}',
    'AIza[0-9A-Za-z_-]{35}',
    'ya29\\.[A-Za-z0-9_-]{40,}',
    'AccDB[A-Za-z0-9+/=]{40,}',
    'dop_v1_[A-Fa-f0-9]{64}',
    'vc_[A-Za-z0-9]{24,}',
    'vercel_[A-Za-z0-9]{24,}',
    // CDN / PaaS
    'CFPAT-[A-Za-z0-9_-]{40,}',
    'dckr_pat_[A-Za-z0-9_-]{27,}',
    // Comms / mail
    'xox[abprs]-[A-Za-z0-9-]{10,}',
    'xapp-[A-Za-z0-9-]{10,}',
    'SG\\.[A-Za-z0-9_-]{20,24}\\.[A-Za-z0-9_-]{39,50}',
    'key-[a-f0-9]{32}',
    'AC[a-f0-9]{32}',
    'SK[a-f0-9]{32}',
    'sq0csp-[A-Za-z0-9_-]{43}',
    // Package managers
    'npm_[A-Za-z0-9]{36}',
    'pypi-AgEIc[A-Za-z0-9_-]{50,}',
    // Data platforms
    'dapi[a-f0-9]{32}',
    // Telemetry / monitoring
    'datadog_api_key_[a-f0-9]{32}',
  ].map((p) => `(?:${p})`).join('|') + ')\\b',
  'g',
)

const BEARER_RX = /\b[Bb]earer\s+[A-Za-z0-9_\-.=+/]{16,}\b/g
const BASIC_AUTH_RX = /\b[Bb]asic\s+[A-Za-z0-9+/=]{12,}={0,2}\b/g
const URL_CREDS_RX = /\b[a-z][a-z0-9+\-.]*:\/\/[^\s/@:"'`<>]+:[^\s/@:"'`<>]+@[A-Za-z0-9.\-]+(?::\d+)?(?:\/[^\s"'`<>]*)?/g

// NAME=VALUE assignment with a credential-shaped suffix. Captures
// the whole assignment so the name (which itself leaks vendor
// intent) is masked alongside the value.
const ENV_VAR_RX = /\b[A-Z][A-Z0-9_]{2,}(?:_KEY|_SECRET|_TOKEN|_PASSWORD|_PASSWD|_PWD|_API_?KEY|_DSN|_URL)\s*=\s*\S+/g

const GENERIC_SECRET_RX = /\b(?:api[_-]?key|secret|token|password|passwd|auth|access[_-]?key|client[_-]?secret|webhook)\b\s*[:=]\s*["']([A-Za-z0-9+/=_\-]{20,})["']/gi

// ── Identity ─────────────────────────────────────────────────────

const CC_RX = /\b(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2})|3[47]\d{2}|3(?:0[0-5]|[68]\d)\d|(?:2131|1800|35\d{3}))[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{3,4}\b/g
const SSN_RX = /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g
const EMAIL_RX = /\b[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\b/g
const PHONE_RX = /(?:\+\d[\d .\-()]{7,16}\d|\(\d{2,4}\)[\d .\-]{6,14}\d)/g
const IPV4_RX = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g
// Permissive match; `validIPv6` below rejects look-alikes (timestamps,
// short colon-separated number strings). Real IPv6 either uses the
// compressed `::` marker or contains the full 8 groups.
//
// Alternation order matters: try compressed forms (`hex:hex::hex`,
// `hex:hex::`) FIRST so the greedy first alt doesn't gobble a 3-group
// prefix of `2606:4700:4700::1111` and orphan the `::1111` tail. The
// uncompressed full form goes last.
const IPV6_RX = /\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:|\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g

/** Distinguishes real IPv6 addresses from look-alikes the broad
 *  regex above also accepts. Timestamps like `12:22:57` and other
 *  short colon-separated decimal sequences must be rejected:
 *
 *   - A canonical IPv6 has 8 groups (`2001:0db8:…:7334`).
 *   - The `::` compression marker is unambiguous when present.
 *
 *  Anything else (e.g. 3-group decimal time-of-day) we drop. */
function validIPv6(value: string): boolean {
  if (value.includes('::')) return true
  return value.split(':').length === 8
}

// ── Location & infra ─────────────────────────────────────────────

const ABSOLUTE_PATH_RX = /(?:\/Users\/|\/home\/|\/var\/|\/etc\/|\/opt\/|[A-Z]:\\Users\\)[A-Za-z0-9._\-/\\À-￿]+/g

// Internal-only hostnames that aren't routable on the public DNS
// but reveal an org's network shape.
//
// Note `.local` is intentionally OMITTED: while it's the mDNS TLD,
// it's also the dominant filename suffix (`.env.local`,
// `settings.local`, `next.config.local`, …) — and we saw ~50%
// false-positive rate from a real-world scan with `.local` enabled.
// The remaining TLDs (`.internal`, `.corp`, `.lan`, `.intra`,
// `.home`, `.prod.*`, `.stg.*`) are unambiguous internal-DNS markers.
const INTERNAL_HOST_RX = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:internal|corp|lan|intra|home|prod\.[a-z0-9]+|stg\.[a-z0-9]+)\b/gi

// ── Per-rule validators (false-positive filters) ─────────────────
//
// Each validator runs after the regex matches. Returning false drops
// the match before it becomes a finding. Composed from the shared
// helpers in validators.ts; per-rule logic stays local to capture
// the kind-specific shape (e.g. env-var has NAME=VALUE structure
// that needs splitting before checking the value).

/** env-var: NAME=VALUE assignment. Reject when name is a
 *  public-by-convention prefix, value is a placeholder or already
 *  redacted, value is a shell substitution (not a literal), or value
 *  is a short JS string constant (`const FOO_KEY = 'app.storage.x'`,
 *  not an env assignment). */
function envVarLooksReal(value: string): boolean {
  const eqIdx = value.indexOf('=')
  if (eqIdx < 0) return false
  const name = value.slice(0, eqIdx).trim()
  if (hasPublicEnvPrefix(name)) return false
  const raw = value.slice(eqIdx + 1).trim()
  if (isObviouslyNonSecretValue(raw)) return false
  // Strip outer quotes / backticks so the value-only checks aren't
  // fooled by `=""` or `='...'`.
  const stripped = raw.replace(/^[`'"]+|[`'"]+$/g, '').trim()
  if (stripped.length < 8) return false
  // Shell substitution / variable reference — value is computed at
  // runtime, the literal isn't actually leaked.
  if (/^\$[({]|^\$\w/.test(stripped)) return false
  // Looks like a JS storage-key string constant: pure letters
  // (any case, supports camelCase / SCREAMING_CASE keys) with
  // dots/underscores/hyphens, NO digits, ≤ 28 chars. Real secrets
  // have digits OR ≥ 32 chars, so the disjoint shape catches values
  // like `'spool.shares.skeletonCount'` / `'theme_editor'` without
  // rejecting a Stripe-style live key (has digits + ≥ 32 chars).
  if (/^[a-zA-Z][a-zA-Z._\-]*$/.test(stripped) && stripped.length < 28) return false
  // Natural-language placeholder text (CJK / Cyrillic / Hangul /
  // Arabic / emoji) in the value. Real env-var secrets are always
  // ASCII; non-ASCII content here is a description like
  // `AGENT_INTERNAL_SECRET='你自己生成的一串随机密钥'`. Scoped to
  // env-var only — see hasNonAsciiContent for why it's not in the
  // shared isObviouslyNonSecretValue.
  if (hasNonAsciiContent(stripped)) return false
  return true
}

/** email: reject filenames (icon_16x16@2x.png), reserved/test
 *  domains (example.com, RFC 2606). */
function emailLooksReal(value: string): boolean {
  if (looksLikeImageAsset(value)) return false
  const atIdx = value.lastIndexOf('@')
  if (atIdx < 0) return false
  const domain = value.slice(atIdx + 1)
  if (isReservedDomain(domain)) return false
  return true
}

/** phone: country code can't start with 0 (ITU E.164). Digit count
 *  in valid E.164 range. Also reject when the digit sequence is just
 *  a year (4 digits at the end with year-like prefix). */
function phoneLooksReal(value: string): boolean {
  if (/^\+0/.test(value)) return false
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return false
  return true
}

/** ip: reject loopback, RFC 5737 docs ranges, RFC 3849 IPv6 doc
 *  range, unspecified address, link-local. */
function ipLooksReal(value: string): boolean {
  return !isReservedIp(value)
}

/** internal-host: reject JS property chains the regex inadvertently
 *  matches (`process.env.HOME`, `import.meta.home`). */
function internalHostLooksReal(value: string): boolean {
  if (/^process\.env\./i.test(value)) return false
  if (/^import\.meta\./i.test(value)) return false
  if (/^window\.location\./i.test(value)) return false
  return true
}

/** Vendor api-key: AWS docs ship `AKIAIOSFODNN7EXAMPLE` literally —
 *  block anything ending in EXAMPLE/SAMPLE/etc. */
function apiKeyLooksReal(value: string): boolean {
  return !isVendorExampleKey(value)
}

/** Multi-line credential blobs (cloud-cred-ini, kubeconfig, netrc,
 *  connection-string, url-creds, basic-auth, bearer) get the
 *  generic "obviously non-secret" guard: rejects when the matched
 *  block contains a redaction marker, ellipsis, or placeholder. */
function credentialBlockLooksReal(value: string): boolean {
  if (isObviouslyNonSecretValue(value)) return false
  // AWS docs example key inside an ini block.
  if (/AKIAIOSFODNN7EXAMPLE|wJalrXUtnFEMI/.test(value)) return false
  return true
}

/** kubeconfig: token value should be high-entropy. The regex
 *  captures `<field>: <value>` — the value is everything after the
 *  colon. Reject if entropy is below ~3.5 (placeholder alphabets
 *  like `abcdefghi…` clock in around 4.7 BUT have all-distinct chars
 *  in a sequence — the entropy floor isn't enough alone). Also
 *  block sequential alphabet / numeric placeholder values. */
function kubeconfigTokenLooksReal(value: string): boolean {
  if (!credentialBlockLooksReal(value)) return false
  const colonIdx = value.indexOf(':')
  if (colonIdx < 0) return true
  const tokenValue = value.slice(colonIdx + 1).trim()
  if (looksLikePlaceholder(tokenValue)) return false
  if (shannon(tokenValue) < 3.0) return false
  return true
}

const RULES: Rule[] = [
  { kind: 'private-key', rx: PEM_RX, confidence: 1.0 },
  { kind: 'ssh-key', rx: SSH_KEY_BODY_RX, confidence: 0.95 },
  { kind: 'cloud-cred-ini', rx: AWS_INI_RX, confidence: 0.95, validate: credentialBlockLooksReal },
  { kind: 'cloud-cred-ini', rx: GCLOUD_JSON_RX, confidence: 0.9, validate: credentialBlockLooksReal },
  { kind: 'kubeconfig-token', rx: KUBECONFIG_RX, confidence: 0.85, validate: kubeconfigTokenLooksReal },
  { kind: 'netrc', rx: NETRC_RX, confidence: 0.95, validate: credentialBlockLooksReal },
  { kind: 'connection-string', rx: CONN_STRING_RX, confidence: 0.9, validate: credentialBlockLooksReal },
  { kind: 'url-creds', rx: URL_CREDS_RX, confidence: 0.95, validate: credentialBlockLooksReal },
  { kind: 'basic-auth', rx: BASIC_AUTH_RX, confidence: 0.9, validate: credentialBlockLooksReal },
  { kind: 'env-var', rx: ENV_VAR_RX, confidence: 0.9, validate: envVarLooksReal },
  { kind: 'generic-secret', rx: GENERIC_SECRET_RX, confidence: 0.6, validate: hasQuotedEntropy(4.0) },
  { kind: 'jwt', rx: JWT_RX, confidence: 0.95 },
  { kind: 'api-key', rx: VENDOR_API_KEY_RX, confidence: 0.98, validate: apiKeyLooksReal },
  { kind: 'bearer', rx: BEARER_RX, confidence: 0.85, validate: credentialBlockLooksReal },
  { kind: 'credit-card', rx: CC_RX, confidence: 0.95, validate: luhnOk },
  { kind: 'ssn', rx: SSN_RX, confidence: 0.85 },
  { kind: 'email', rx: EMAIL_RX, confidence: 0.85, validate: emailLooksReal },
  { kind: 'phone', rx: PHONE_RX, confidence: 0.7, validate: phoneLooksReal },
  { kind: 'ip', rx: IPV4_RX, confidence: 0.55, validate: ipLooksReal },
  { kind: 'ip', rx: IPV6_RX, confidence: 0.6, validate: (v) => validIPv6(v) && ipLooksReal(v) },
  { kind: 'internal-host', rx: INTERNAL_HOST_RX, confidence: 0.55, validate: internalHostLooksReal },
  { kind: 'absolute-path', rx: ABSOLUTE_PATH_RX, confidence: 0.75 },
]

/** Synchronous regex-driven scan. Rules earlier in the priority list
 *  claim their regions first; later, broader rules whose match
 *  overlaps a claimed region are dropped. This is what makes a JWT
 *  inside a `Bearer` header surface as a JWT, and a Stripe key inside
 *  `STRIPE_SECRET_KEY=…` surface as the whole assignment. */
export function detectWithRegex(text: string, providerName = 'regex'): SensitiveMatch[] {
  const matches: SensitiveMatch[] = []
  const claimed: { start: number; end: number }[] = []
  const overlaps = (s: number, e: number) =>
    claimed.some((c) => s < c.end && e > c.start)

  for (const rule of RULES) {
    rule.rx.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.rx.exec(text)) !== null) {
      const value = m[0]
      const start = m.index
      const end = start + value.length
      const advance = () => {
        if (m && m.index === rule.rx.lastIndex) rule.rx.lastIndex++
      }
      if (rule.validate && !rule.validate(value)) {
        advance()
        continue
      }
      if (overlaps(start, end)) {
        advance()
        continue
      }
      matches.push({
        kind: rule.kind,
        value,
        start,
        end,
        confidence: rule.confidence,
        provider: providerName,
      })
      claimed.push({ start, end })
      advance()
    }
  }
  matches.sort((a, b) => a.start - b.start)
  return matches
}
