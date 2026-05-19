// Public types for @spool-lab/redact.
//
// Stable interface so callers (Share editor, future Security Scan,
// CLI doctor) don't break when we add detector kinds or swap the
// internal provider. New `SensitiveKind` values are additive — never
// rename or repurpose existing ones.

/** Every category the detector can emit. New kinds get appended; the
 *  set is exhaustive so consumers can pattern-match it safely. */
export type SensitiveKind =
  // ── Credentials (highest stakes) ─────────────────────────────────
  | 'private-key'        // PEM-armoured private key block
  | 'ssh-key'            // OpenSSH or SSH2 private key body
  | 'api-key'            // Vendor-prefixed token (Stripe, OpenAI, …)
  | 'cloud-cred-ini'     // ~/.aws/credentials, gcloud auth INI block
  | 'kubeconfig-token'   // kubeconfig token/data field
  | 'connection-string'  // postgres://, mongodb://, redis://, …
  | 'jwt'                // RFC 7519 JWT
  | 'bearer'             // `Authorization: Bearer …` (non-JWT)
  | 'basic-auth'         // `Authorization: Basic …`
  | 'env-var'            // NAME=VALUE where NAME = *_KEY|*_SECRET|…
  | 'generic-secret'     // keyword + entropy-gated quoted value
  | 'netrc'              // .netrc machine/login/password line
  // ── Identity ─────────────────────────────────────────────────────
  | 'email'
  | 'phone'
  | 'person-name'        // ML-only (Privacy Filter `person` class)
  | 'street-address'     // ML-only (Privacy Filter `address` class)
  | 'date-of-birth'      // ML-only, context-gated to DOB-like dates
  | 'credit-card'        // Luhn-validated
  | 'ssn'                // US SSN, format-only
  | 'ip'                 // IPv4 / shortened IPv6
  // ── Location & infra ─────────────────────────────────────────────
  | 'url-creds'          // URL with embedded user:password
  | 'absolute-path'      // Unix/Windows home or system path
  | 'internal-host'      // *.internal, *.corp, *.local, *.lan

export interface SensitiveMatch {
  kind: SensitiveKind
  /** The literal substring detected, suitable to pass to a redact
   *  substituter. For multi-line kinds (private-key, cloud-cred-ini)
   *  this is the entire block so the whole thing gets masked. */
  value: string
  /** Character offset within the input string. */
  start: number
  /** Exclusive end offset. */
  end: number
  /** Heuristic 0–1.
   *   1.0  Structural certainty — PEM block, Luhn-valid card.
   *   ≥0.9 Strong vendor prefix or composite signal.
   *   ≥0.7 Format match without checksum.
   *   <0.7 Context-only signal, surface for user review.
   */
  confidence: number
  /** Which provider produced this match (`'regex'` today; future
   *  values: `'privacy-filter'`, `'gliner'`, …). Lets the editor UI
   *  show "model-detected" vs "rule-detected" badges and lets a
   *  future security-scan report attribute matches. */
  provider: string
}

export interface SensitiveValue {
  value: string
  /** Number of times this exact literal appeared in the source.
   *  Always ≥ 1. Useful for surfacing "same token printed twice"
   *  without rendering duplicate rows. */
  count: number
}

export interface SensitiveGroup {
  kind: SensitiveKind
  /** Total number of matches in this group (sum of every value's
   *  occurrence count). Drives the `×N` header label. */
  count: number
  /** Distinct values for this kind, in first-seen detection order,
   *  each paired with its occurrence count. Editor renders one row
   *  per entry — so a value that appears 3× is one decision, not
   *  three. */
  values: SensitiveValue[]
  /** Worst-case (lowest) confidence in this group — drives the
   *  "review" badge in the editor. */
  minConfidence: number
}

/** Display order — strict risk descent. Credentials (a single leak
 *  is potentially catastrophic) come first; identity / location
 *  signals (annoying but recoverable) come last. Items that travel
 *  together stay adjacent: cred files (PEM / SSH / cloud INI /
 *  kubeconfig / netrc); URL-form creds (conn-string / url-creds);
 *  token-form creds (api-key / jwt / bearer / basic-auth /
 *  env-var / generic-secret); finally financial / identity / infra. */
export const SENSITIVE_KIND_ORDER: SensitiveKind[] = [
  'private-key',
  'ssh-key',
  'cloud-cred-ini',
  'kubeconfig-token',
  'netrc',
  'connection-string',
  'url-creds',
  'api-key',
  'jwt',
  'bearer',
  'basic-auth',
  'env-var',
  'generic-secret',
  'credit-card',
  'ssn',
  'email',
  'phone',
  'person-name',
  'street-address',
  'date-of-birth',
  'ip',
  'absolute-path',
  'internal-host',
]

export const SENSITIVE_KIND_LABEL: Record<SensitiveKind, string> = {
  'private-key': 'Private key',
  'ssh-key': 'SSH private key',
  'cloud-cred-ini': 'Cloud credentials',
  'kubeconfig-token': 'kubeconfig token',
  'connection-string': 'Connection string',
  'api-key': 'API key',
  'netrc': '.netrc entry',
  'jwt': 'JWT',
  'bearer': 'Bearer token',
  'basic-auth': 'Basic auth',
  'env-var': 'Env-var secret',
  'generic-secret': 'Generic secret',
  'url-creds': 'URL credential',
  'credit-card': 'Credit card',
  'ssn': 'SSN',
  'email': 'Email',
  'phone': 'Phone',
  'person-name': 'Person name',
  'street-address': 'Street address',
  'date-of-birth': 'Date of birth',
  'ip': 'IP address',
  'absolute-path': 'Absolute path',
  'internal-host': 'Internal hostname',
}
