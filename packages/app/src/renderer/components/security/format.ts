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

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const formatted = value >= 100 || unit === 0
    ? Math.round(value).toString()
    : value.toFixed(1).replace(/\.0$/, '')
  return `${formatted} ${units[unit]}`
}
