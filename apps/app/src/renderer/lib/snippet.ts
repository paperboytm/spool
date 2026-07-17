/** Rewrites `<mark>` tags from core's buildLikeSnippet to `<strong>`
 *  so renderer surfaces can style highlights via their own `<strong>`
 *  rules (accent color, font weight, etc.) without each surface
 *  carrying the same regex.
 *
 *  The snippet text comes straight from indexed session content and is
 *  rendered via `dangerouslySetInnerHTML`, so everything except the
 *  highlight markers we inject ourselves is HTML-escaped — a session
 *  whose body contains markup is shown as inert text, never parsed. */
export function snippetToStrongHtml(snippet: string): string {
  return snippet
    .split(/(<\/?mark>)/)
    .map((part) =>
      part === '<mark>' ? '<strong>' : part === '</mark>' ? '</strong>' : escapeHtml(part),
    )
    .join('')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
