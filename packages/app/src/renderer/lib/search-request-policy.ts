export type FastSearchRequest = 'preview' | 'full' | 'none'

export function resolveFastSearchRequest(homeMode: boolean, query: string): FastSearchRequest {
  if (!query.trim()) return 'none'
  return homeMode ? 'preview' : 'full'
}
