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
  // No whitespace between tags. Satori (the engine inside workers-og)
  // counts inter-element whitespace as text children, so a multi-line
  // template-literal would turn this outer div into "3 elements + 4
  // text nodes = 7 children" and fail with "expected display: flex".
  // Keeping it inline avoids needing display: flex / display: none on
  // every nested div as well.
  return (
    `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;padding:60px;background:#FAF7F0;font-family:Inter,system-ui,sans-serif">` +
    `<div style="font-size:28px;color:#C85A00;letter-spacing:0.12em;text-transform:uppercase">spool · share</div>` +
    `<div style="font-size:64px;color:#141410;line-height:1.15;font-weight:500">${title}</div>` +
    `<div style="font-size:22px;color:#6b6857">${template} · ${date}</div>` +
    `</div>`
  )
}

export async function renderOgPng(snap: SnapshotForOg): Promise<ArrayBuffer> {
  const html = buildOgHtml(snap)
  const res = new ImageResponse(html, { width: 1200, height: 630 })
  return res.arrayBuffer()
}
