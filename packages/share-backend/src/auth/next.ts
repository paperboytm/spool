export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  if (raw.split('/').some((seg) => seg === '..')) return '/'
  return raw
}
