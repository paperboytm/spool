import { SENSITIVE_KIND_LABEL, type SensitiveKind } from '@spool-lab/redact'

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
  return SENSITIVE_KIND_LABEL[kind as SensitiveKind] ?? kind
}
