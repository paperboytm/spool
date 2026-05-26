// Per-kind redaction masks.
//
// The naive substitution — every match → `[redacted]` — works but
// throws away too much context. A reader of the published artifact
// sees a wall of identical placeholders with no idea which were
// credentials, which were emails, which were paths. Per-kind masks
// keep just enough structure for the artifact to remain readable:
//
//   STRIPE_SECRET_KEY=sk_live_abc…  →  STRIPE_SECRET_KEY=[redacted]
//   maya@example.com                →  m***@example.com
//   4111 1111 1111 1111             →  **** **** **** 1111
//   postgres://u:p@host/db          →  postgres://[redacted]
//   ghp_abcdef…                     →  [redacted: GitHub key]
//
// Trade-off: a mask that retains structure (scheme, domain, last-4,
// vendor name) leaks slightly more than `[redacted]`. The judgement
// call is that those fragments are NOT secrets themselves — the
// scheme of a connection string is public, the domain of an email
// is usually public, vendor token prefixes are documented. What's
// secret is the random tail.

import type { SensitiveKind } from './types.js'

/** Compute the per-kind replacement string for a detected match.
 *  `kind` is loosely typed so synthetic categories (author names,
 *  manual entries) also get a sensible default. */
export function maskValueByKind(value: string, kind: SensitiveKind | string): string {
  switch (kind) {
    case 'private-key':
      return `[redacted private key · ${formatBytes(value.length)}]`
    case 'ssh-key':
      return `[redacted SSH key · ${formatBytes(value.length)}]`

    case 'api-key': {
      const vendor = detectVendor(value)
      return vendor ? `[redacted: ${vendor} key]` : '[redacted API key]'
    }
    case 'jwt':
      return '[redacted JWT]'

    case 'cloud-cred-ini': {
      if (/aws_(access|secret|session)_/i.test(value)) return '[redacted AWS credentials]'
      if (/refresh_token|client_secret|access_token/i.test(value)) return '[redacted Google credentials]'
      return '[redacted cloud credentials]'
    }
    case 'kubeconfig-token': {
      const m = value.match(/^([a-z-]+)\s*:/i)
      return m ? `${m[1]}: [redacted]` : '[redacted kubeconfig token]'
    }
    case 'netrc':
      return 'machine [redacted] login [redacted] password [redacted]'

    case 'connection-string': {
      const m = value.match(/^([a-z][a-z0-9+\-.]*):\/\//i)
      return m ? `${m[1]}://[redacted]` : '[redacted connection string]'
    }
    case 'url-creds': {
      const m = value.match(/^([a-z][a-z0-9+\-.]*):\/\/[^@]+@([^\s/]+)(\/[^\s]*)?$/i)
      return m ? `${m[1]}://[redacted:redacted]@${m[2]}${m[3] ?? ''}` : '[redacted URL]'
    }

    case 'bearer':
      return 'Bearer [redacted]'
    case 'basic-auth':
      return 'Basic [redacted]'

    case 'env-var': {
      // NAME=VALUE — preserve NAME, mask VALUE. The user has already
      // consented to redact by toggling, so the assignment NAME is
      // surfaced to keep the line readable.
      const m = value.match(/^([A-Z][A-Z0-9_]*)\s*=/)
      return m ? `${m[1]}=[redacted]` : '[redacted env-var]'
    }
    case 'generic-secret': {
      // The match capture is "keyword : value" or "keyword = value".
      // Preserve the keyword prefix verbatim so the assignment shape
      // survives.
      const m = value.match(/^([^"'\s:=]+\s*[:=]\s*)["']/)
      return m ? `${m[1]}"[redacted]"` : '[redacted secret]'
    }

    case 'credit-card': {
      const digits = value.replace(/\D/g, '')
      const last4 = digits.slice(-4) || '****'
      return `**** **** **** ${last4}`
    }
    case 'ssn': {
      const last4 = value.slice(-4)
      return `***-**-${last4}`
    }

    case 'email': {
      const at = value.indexOf('@')
      if (at <= 0) return '[redacted email]'
      const first = value[0] ?? ''
      const domain = value.slice(at + 1)
      // Don't reveal more than the first char of the local part. For
      // single-char local parts ("a@x.com"), use a literal asterisk.
      return `${first}***@${domain}`
    }
    case 'phone':
      return '[redacted phone]'

    case 'person-name':
      return '[redacted name]'
    case 'street-address':
      return '[redacted address]'
    case 'date-of-birth':
      return '[redacted DOB]'

    case 'ip':
      // Preserve shape so readers know it was a network address; the
      // four-octet pattern matters more than the digits.
      return value.includes(':') ? '[redacted IPv6]' : '[redacted IPv4]'
    case 'internal-host': {
      const m = value.match(/\.([a-z0-9-]+(?:\.[a-z0-9-]+)*)$/i)
      return m ? `[redacted].${m[1]}` : '[redacted internal host]'
    }
    case 'absolute-path': {
      const m = value.match(/^(\/Users\/|\/home\/|\/var\/|\/etc\/|\/opt\/|[A-Z]:\\Users\\)/)
      return m ? `${m[1]}[redacted]` : '[redacted path]'
    }

    // Synthetic kinds emitted by the Share editor's PII layer.
    case 'synthetic:author':
      return '[redacted name]'
    case 'synthetic:manual':
      return '[redacted]'

    default:
      return '[redacted]'
  }
}

/** Recognise the vendor behind a token by its prefix. Returns null
 *  when the prefix isn't one we've codified — the caller falls
 *  back to a generic `[redacted API key]` mask. */
export function detectVendor(token: string): string | null {
  if (/^sk_(live|test)_/.test(token)) return 'Stripe'
  if (/^(rk|pk)_(live|test)_/.test(token)) return 'Stripe'
  if (/^sk-ant-/.test(token)) return 'Anthropic'
  if (/^sk-proj-/.test(token)) return 'OpenAI'
  if (/^sk-/.test(token)) return 'OpenAI'
  if (/^hf_/.test(token)) return 'Hugging Face'
  if (/^gh[pousr]_/.test(token)) return 'GitHub'
  if (/^glpat-/.test(token)) return 'GitLab'
  if (/^(AKIA|ASIA)/.test(token)) return 'AWS'
  if (/^AIza/.test(token)) return 'Google'
  if (/^ya29\./.test(token)) return 'Google'
  if (/^xox[abprs]-|^xapp-/.test(token)) return 'Slack'
  if (/^SG\./.test(token)) return 'SendGrid'
  if (/^key-[a-f0-9]/.test(token)) return 'Mailgun'
  if (/^AC[a-f0-9]/.test(token)) return 'Twilio'
  if (/^SK[a-f0-9]/.test(token)) return 'Twilio'
  if (/^sq0csp-/.test(token)) return 'Square'
  if (/^npm_/.test(token)) return 'npm'
  if (/^pypi-/.test(token)) return 'PyPI'
  if (/^dop_v1_/.test(token)) return 'DigitalOcean'
  if (/^vc_|^vercel_/.test(token)) return 'Vercel'
  if (/^CFPAT-/.test(token)) return 'Cloudflare'
  if (/^dckr_pat_/.test(token)) return 'Docker Hub'
  if (/^dapi/.test(token)) return 'Databricks'
  return null
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
