// Normalise a server-supplied title before it goes into document.title.
//
// document.title doesn't execute markup, so this is not an XSS vector —
// but a raw title containing newlines, control characters, or a stray
// `</title>` shows garbage in the browser tab, and it's inconsistent
// with the SSR OG path (og-meta.ts) which escapes + length-caps. We
// drop control characters, collapse whitespace, and bound the length so
// the tab stays sane.

const MAX_TAB_TITLE_LEN = 120

// C0 + C1 control characters (incl. newline / tab). Stripped, not
// space-replaced, before whitespace collapse handles the rest.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

export function normalizeTabTitle(raw: string): string {
  // Collapse whitespace (incl. newlines / tabs) to single spaces first,
  // THEN strip any remaining non-whitespace control characters — so a
  // newline becomes a space rather than vanishing.
  const cleaned = raw.replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').trim()
  return cleaned.length > MAX_TAB_TITLE_LEN
    ? `${cleaned.slice(0, MAX_TAB_TITLE_LEN - 1)}…`
    : cleaned
}
