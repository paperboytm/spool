/**
 * Compact, plain-text preview used by turn selectors and prompt
 * directories. It intentionally mirrors the desktop TurnSelector rules:
 * only the first non-empty line is considered and a small set of leading
 * Markdown markers is removed.
 *
 * This module is deliberately DOM-free so desktop, web, and Node tooling
 * can share the projection without importing the renderer bundle.
 */
export function firstLinePreview(body: string): string {
  const lines = body.split('\n')
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    return trimmed
      .replace(/^`{3,}.*$/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/`/g, '')
      .trim()
  }
  return ''
}
