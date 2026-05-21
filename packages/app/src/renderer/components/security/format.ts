import { SENSITIVE_KIND_LABEL, type SensitiveKind } from '@spool-lab/redact'

/** Drops the long `claude-sonnet-4-5-20251022` form to `sonnet 4.5`.
 *  Mirrors SessionRow's helper. */
export function compactModel(model: string | null | undefined): string {
  if (!model) return ''
  const m = model.match(/^claude-(opus|sonnet|haiku)(?:-(\d+))?(?:-(\d+))?$/)
  if (!m) return model
  const name = m[1]!
  const major = m[2]
  const minor = m[3]
  if (minor) return `${name} ${major}.${minor}`
  if (major) return `${name} ${major}`
  return name
}

export function friendlyMaskName(kind: string): string {
  // Single source of truth — same lookup the rest of the security UI
  // uses. Unknown kinds fall back to the raw enum value (will only
  // happen if a future SensitiveKind ships before the locale strings
  // catch up).
  return SENSITIVE_KIND_LABEL[kind as SensitiveKind] ?? kind
}
