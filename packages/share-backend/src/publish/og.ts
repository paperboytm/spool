import { ImageResponse, loadGoogleFont } from 'workers-og'

export type SnapshotForOg = {
  conversation: { title: string }
  publish: { published_at: string }
  editor_opts: { template: string; paper: string; colorway: string }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return c
    }
  })
}

// 140-char truncation kept in one place so the same string drives both
// the rendered title and the font-subset fetch — otherwise a long title
// would load glyphs we never paint.
export function clampTitle(raw: string): string {
  return escapeHtml(raw).slice(0, 140)
}

export function buildOgHtml(snap: SnapshotForOg): string {
  const title = clampTitle(snap.conversation.title)
  const template = escapeHtml(snap.editor_opts.template)
  const date = new Date(snap.publish.published_at).toLocaleDateString()
  // Satori (inside workers-og) is strict about layout: every div that
  // ever has more than one child node must declare `display: flex`,
  // and that turns out to include divs whose text content has multiple
  // tokens. Easiest correct shape: declare display: flex everywhere
  // and keep the literal whitespace-free so we don't accidentally add
  // text-node siblings between elements.
  // Satori does NOT resolve `width: 100%` to the canvas dimensions the
  // way a browser would — flex column children collapse to content width
  // instead. Hard-code the 1200×630 dimensions so the cream paper fills
  // the whole OG image rather than leaving a grey gutter on the right.
  //
  // Font-family chain: Inter → Noto Sans SC → system-ui. Satori walks
  // the chain per glyph, so Latin chars resolve to Inter and CJK chars
  // fall through to Noto Sans SC. Without Noto Sans SC in the loaded
  // fonts list, CJK glyphs render as black "NO GLYPH" placeholder
  // boxes (the Satori default for unmapped codepoints).
  return (
    `<div style="display:flex;flex-direction:column;justify-content:space-between;width:1200px;height:630px;padding:60px;background:#FAF7F0;font-family:Inter,'Noto Sans SC',system-ui,sans-serif">` +
    `<div style="display:flex;font-size:28px;color:#C85A00;letter-spacing:0.12em;text-transform:uppercase">spool · share</div>` +
    `<div style="display:flex;font-size:64px;color:#141410;line-height:1.15;font-weight:500">${title}</div>` +
    `<div style="display:flex;font-size:22px;color:#6b6857">${template} · ${date}</div>` +
    `</div>`
  )
}

/** Collect every distinct character that the OG image will paint, so
 *  Google Fonts' `text=` subset endpoint returns only the glyphs we
 *  actually need (a few KB per request) instead of the full ~3 MB CJK
 *  blob. Satori looks up each codepoint independently, so the order
 *  doesn't matter — we just need the set. */
function uniqueCharsFor(snap: SnapshotForOg): string {
  const title = clampTitle(snap.conversation.title)
  const template = escapeHtml(snap.editor_opts.template)
  const date = new Date(snap.publish.published_at).toLocaleDateString()
  const wordmark = 'SPOOL · SHARE'
  const all = `${title}${template}${date}${wordmark}`
  return Array.from(new Set(all)).join('')
}

export async function renderOgPng(snap: SnapshotForOg): Promise<ArrayBuffer> {
  const html = buildOgHtml(snap)
  const text = uniqueCharsFor(snap)
  // Load font subsets in parallel. Both failures degrade gracefully:
  // Satori still renders with whichever subset arrived (and shows
  // "NO GLYPH" boxes for the missing script — same as the pre-fix
  // behaviour). Worst case: Google Fonts is down, we get an OG image
  // that says "Shared conversation" in default sans with no glyphs.
  const [inter, cjk] = await Promise.all([
    loadGoogleFont({ family: 'Inter', weight: 500, text }).catch(() => null),
    loadGoogleFont({ family: 'Noto Sans SC', weight: 500, text }).catch(() => null),
  ])
  const fonts: { name: string; data: ArrayBuffer; weight: 500; style: 'normal' }[] = []
  if (inter) fonts.push({ name: 'Inter', data: inter, weight: 500, style: 'normal' })
  if (cjk) fonts.push({ name: 'Noto Sans SC', data: cjk, weight: 500, style: 'normal' })

  const res = new ImageResponse(html, {
    width: 1200,
    height: 630,
    ...(fonts.length > 0 ? { fonts } : {}),
  })
  return res.arrayBuffer()
}
