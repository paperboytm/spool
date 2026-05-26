// Non-reversible recognition previews for ignored findings.
//
// Distinct from `maskValueByKind` (mask.ts), which produces an
// in-place replacement label for the *published* artifact
// (`[redacted: Stripe key]`). A preview is what we show the user in
// the "Ignored items" list so they can RECOGNISE which value they
// chose to ignore — without ever storing the plaintext.
//
// The allowlist deliberately stores only a non-crypto hash of the
// value (for matching on rescan). A hash slice is unreadable. The
// preview fills that recognition gap with the smallest disclosure
// that still lets a human go "ah, that one":
//
//   sk_live_51Hxyz…a39f   →  Stripe ••a39f
//   ghp_AbCd…wxyz         →  GitHub ••wxyz
//   maya@example.com      →  m••@example.com
//   4111 1111 1111 1111   →  •• 1111
//
// Non-reversibility contract: a preview retains only fragments that
// are NOT themselves secret —
//   • a vendor name inferred from a public, documented token prefix,
//   • an email domain (routinely public),
//   • at most the last 4 characters of a credential / card.
// The random body of the secret is dropped entirely, so a preview
// can never be expanded back into the original value. Short values
// (< 4 meaningful chars) collapse to a kind-only hint rather than
// leaking the whole thing.

import type { SensitiveKind } from './types.js'
import { detectVendor } from './mask.js'

const DOT = '••' // "••"

/** Compute a short, non-reversible recognition preview for a value the
 *  user is ignoring. Returns `null` when no useful preview can be
 *  formed without leaking — the caller then falls back to the kind
 *  label alone. */
export function previewValueByKind(
  value: string,
  kind: SensitiveKind | string,
): string | null {
  const v = value.trim()
  if (v.length === 0) return null

  switch (kind) {
    case 'email': {
      const at = v.indexOf('@')
      if (at <= 0) return null
      const first = v[0] ?? ''
      const domain = v.slice(at + 1)
      if (domain.length === 0) return null
      return `${first}${DOT}@${domain}`
    }

    case 'api-key':
    case 'bearer':
    case 'basic-auth':
    case 'jwt':
    case 'private-key':
    case 'ssh-key':
    case 'kubeconfig-token':
    case 'generic-secret': {
      const vendor = detectVendor(v)
      const tail = lastN(v, 4)
      if (vendor && tail) return `${vendor} ${DOT}${tail}`
      if (vendor) return vendor
      if (tail) return `${DOT}${tail}`
      return null
    }

    case 'credit-card': {
      const digits = v.replace(/\D/g, '')
      const last4 = digits.slice(-4)
      return last4.length === 4 ? `${DOT} ${last4}` : null
    }
    case 'ssn': {
      const last4 = v.replace(/\D/g, '').slice(-4)
      return last4.length === 4 ? `${DOT}-${DOT}-${last4}` : null
    }

    case 'connection-string':
    case 'url-creds': {
      const m = v.match(/^([a-z][a-z0-9+\-.]*):\/\//i)
      return m ? `${m[1]}://${DOT}` : null
    }

    case 'internal-host': {
      // Reveal only the registrable-ish suffix, mask the host label.
      const m = v.match(/\.([a-z0-9-]+(?:\.[a-z0-9-]+)*)$/i)
      return m ? `${DOT}.${m[1]}` : null
    }

    default:
      // Identity-tier kinds (person-name, phone, address, DOB), IPs,
      // absolute paths, etc. don't get a partial preview — any
      // fragment of them is still identifying. Kind label alone.
      return null
  }
}

/** Last `n` characters, or null when the value is too short to spare
 *  them without effectively revealing the whole thing (we require at
 *  least `2n` so the tail is a true minority of the value). */
function lastN(value: string, n: number): string | null {
  if (value.length < n * 2) return null
  return value.slice(-n)
}
