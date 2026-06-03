import { ImageResponse } from 'workers-og'

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

export function buildOgHtml(snap: SnapshotForOg): string {
  const title = escapeHtml(snap.conversation.title).slice(0, 140)
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
  return (
    `<div style="display:flex;flex-direction:column;justify-content:space-between;width:1200px;height:630px;padding:60px;background:#FAF7F0;font-family:Inter,system-ui,sans-serif">` +
    `<div style="display:flex;font-size:28px;color:#C85A00;letter-spacing:0.12em;text-transform:uppercase">spool · share</div>` +
    `<div style="display:flex;font-size:64px;color:#141410;line-height:1.15;font-weight:500">${title}</div>` +
    `<div style="display:flex;font-size:22px;color:#6b6857">${template} · ${date}</div>` +
    `</div>`
  )
}

export async function renderOgPng(snap: SnapshotForOg): Promise<ArrayBuffer> {
  const html = buildOgHtml(snap)
  const res = new ImageResponse(html, { width: 1200, height: 630 })
  return res.arrayBuffer()
}
