export const DEFAULT_BACKEND = 'https://spool.pro'

export function backendUrl(): string {
  return process.env['SPOOL_SHARE_BACKEND'] ?? DEFAULT_BACKEND
}
