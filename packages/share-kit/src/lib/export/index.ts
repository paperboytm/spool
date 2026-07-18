// Local export pipeline — 100% in-browser. Never uploads.
//
// PNG: DOM → html-to-image → PNG blob → save.
// PDF: clone the artifact into a print-only host and call window.print().
//      The browser's Save-as-PDF path keeps text as real text (selectable,
//      searchable, copyable), which embedding a PNG into pdf-lib cannot.
// Markdown lives in ../storage/markdown-file.ts — text-only, honors
// the editor's content opts (selection, redact, gaps).
//
// Save UX: when the browser supports File System Access API
// (`showSaveFilePicker`), we surface a native save dialog so the user
// can pick the folder and rename the file inline. Browsers without
// it (Safari, Firefox) fall back to the classic `<a download>` path
// that drops into the default Downloads folder. PDF gets the same
// UX via the browser's Save-as-PDF dialog inside window.print().

import { toBlob } from 'html-to-image'

import { sanitizeFilename } from '../filename'
import type { Conversation, Template } from '../types'

export type ExportFormat = 'png' | 'pdf'

interface ExportArgs {
  /** The full-size (unscaled) DOM node containing the rendered template. */
  node: HTMLElement
  template: Template
  conversation: Conversation
  /** Force the rasterization area to these CSS-pixel dimensions instead
   *  of trusting node.clientWidth / node.scrollHeight. The kit's
   *  templates render at a known intrinsic width (TEMPLATE_RATIO[template].w);
   *  hosts that wrap the preview in flex / overflow chrome can get
   *  measurement quirks where the wrapper's measured width collapses
   *  to its content's shrunk box and the resulting PNG comes out
   *  narrow. Passing dims sidesteps that. */
  dims?: { width: number; height: number }
}

export async function exportArtifact(format: ExportFormat, args: ExportArgs): Promise<void> {
  await document.fonts.ready

  switch (format) {
    case 'png':
      return exportPng(args)
    case 'pdf':
      return exportPdf(args)
  }
}

async function exportPng({ node, template, conversation, dims }: ExportArgs): Promise<void> {
  // 3× pixel ratio keeps text crisp on retina phones where these
  // get posted most often.
  const blob = await renderBlob(node, 3, dims)
  await saveBlob(blob, filenameFor(conversation, template, 'png'), {
    description: 'PNG image',
    mime: 'image/png',
    ext: '.png',
  })
}

/**
 * Wrap `html-to-image`'s `toBlob` with a safeguard: we skip its
 * web-font inlining step because browsers block `cssRules` access on
 * cross-origin stylesheets (including Fontsource's subset splits).
 * Our fonts are preloaded via @font-face in global.css, so the canvas
 * renderer has them available without re-embedding.
 */
// Chromium's max canvas dimension on a single axis. html-to-image's
// built-in checkCanvasDimensions will rescale the LONGER axis down to
// this limit AND shrink the OTHER axis proportionally — so a 720×88000
// conversation at 3× pixelRatio becomes a useless 134×16384 sliver.
// We cap pixelRatio up-front so the resulting canvas fits, and we
// disable html-to-image's autoscaling as a belt-and-suspenders.
const CANVAS_MAX_AXIS = 16384

/**
 * Thrown when a conversation is too tall (or wide) to fit into a
 * single PNG canvas axis. Hosts should catch this and steer the user
 * toward PDF export, which has no equivalent dimension cap.
 */
export class PngTooTallError extends Error {
  readonly width: number
  readonly height: number
  readonly maxAxis: number
  constructor(width: number, height: number, maxAxis: number) {
    super(
      `Conversation is too tall for a single PNG (${width}×${height}px; max axis is ${maxAxis}px). ` +
        `Use PDF export instead — PDF has no canvas size limit.`,
    )
    this.name = 'PngTooTallError'
    this.width = width
    this.height = height
    this.maxAxis = maxAxis
  }
}

async function renderBlob(
  node: HTMLElement,
  pixelRatio: number,
  dims?: { width: number; height: number },
): Promise<Blob> {
  const width = dims?.width ?? node.clientWidth
  const height = dims?.height ?? node.scrollHeight
  const longestAxis = Math.max(width, height)
  // Hard refuse if even ratio=1 won't fit in a single canvas axis.
  // PNG export is fundamentally constrained by the 16384px canvas
  // limit and there's no honest way to fit a 90k-pixel-tall
  // conversation into one image. Callers should suggest PDF.
  if (longestAxis > CANVAS_MAX_AXIS) {
    throw new PngTooTallError(width, height, CANVAS_MAX_AXIS)
  }
  const safeRatio = Math.max(1, Math.min(pixelRatio, Math.floor(CANVAS_MAX_AXIS / longestAxis)))

  const opts: Parameters<typeof toBlob>[1] = {
    pixelRatio: safeRatio,
    cacheBust: true,
    skipFonts: true,
    skipAutoScale: true,
  }
  if (dims) {
    opts.width = dims.width
    opts.height = dims.height
    opts.style = { width: `${dims.width}px`, height: `${dims.height}px` }
  }
  if (safeRatio < pixelRatio) {
    console.warn(
      `[share-kit] PNG capped to ${safeRatio}× (requested ${pixelRatio}×) — content is ${width}×${height}px and would exceed canvas axis limit ${CANVAS_MAX_AXIS}.`,
    )
  }
  const blob = await toBlob(node, opts)
  if (!blob) throw new Error('Failed to rasterize artifact — browser returned no blob.')
  return blob
}

/**
 * The @media print stylesheet that scopes printing to a single
 * artifact and centers it on the page. Extracted as a pure string so
 * it can be unit-tested without a real DOM — see
 * `index.test.ts` for the regression suite.
 *
 * Why this looks the way it does:
 *  - `width: 100%` on html/body locks the print containing block to
 *    Chromium's print viewport (which equals the page width). On-
 *    screen viewport sizes leaking through were the original bug:
 *    body was 924px wide during print, host got centered there, and
 *    the result landed off-center on the actual A4 page.
 *  - `margin: 0 auto` on the host then deterministically centers it
 *    on the page.
 *  - No `@page { size: ... }` here on purpose — the main process owns
 *    page size (A4) via Electron's printToPDF options. Setting it
 *    here would race with that.
 */
/** A4 page width at 96dpi (8.27 in × 96 px/in ≈ 794 px). The print
 *  CSS pins body to this so margin-auto-centering on the host lands
 *  on the actual page center — `width: 100%` is interpreted relative
 *  to Chromium's print rendering viewport (which can be wider than
 *  the page itself) and breaks centering. */
const A4_WIDTH_PX = 794

export function pdfPrintCss(widthPx: number, pageWidthPx = A4_WIDTH_PX): string {
  return `
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: ${pageWidthPx}px !important;
        max-width: ${pageWidthPx}px !important;
        min-width: 0 !important;
        overflow: visible !important;
      }
      body > *:not(.spool-print-host) { display: none !important; }
      body { background: white !important; }
      .spool-print-host {
        position: static !important;
        left: auto !important;
        top: auto !important;
        display: block !important;
        width: ${widthPx}px !important;
        max-width: 100% !important;
        margin: 0 auto !important;
      }
      .spool-print-host > * {
        box-shadow: none !important;
        width: 100% !important;
        max-width: 100% !important;
      }
      .spool-print-host > * > * {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
    }
  `
}

/**
 * Set up a print host so a subsequent webContents.printToPDF() (or
 * window.print()) only sees the artifact, at its full intrinsic size,
 * with no page background or browser chrome.
 *
 * Returns a `cleanup` callback the host MUST call once the print job
 * has either resolved or thrown — otherwise the print-host clone +
 * @media print stylesheet leak into the document.
 *
 * Splitting this out lets Electron hosts call webContents.printToPDF()
 * via IPC and get back a PDF Buffer (which they can preview in-app)
 * instead of routing through window.print() and the OS print dialog.
 */
export function installPdfPrintHost(
  node: HTMLElement,
  conversation: Conversation,
  template: Template,
  dims?: { width: number; height: number },
): { cleanup: () => void; widthPx: number; heightPx: number; filename: string } {
  const widthPx = dims?.width ?? node.clientWidth

  const host = document.createElement('div')
  host.className = 'spool-print-host'
  host.style.cssText = 'position:fixed;left:-100000px;top:0;'
  const clone = node.cloneNode(true) as HTMLElement
  host.appendChild(clone)
  document.body.appendChild(host)

  // Trust the on-screen node's scrollHeight (caller passes it via
  // dims). Pad by a generous margin (32px) to absorb sub-pixel
  // rendering drift between screen rendering and Chromium's print
  // pipeline — otherwise the artifact bleeds into a second page with
  // mostly empty space. Don't over-pad: a too-large page is just as
  // bad (PDF viewer zooms out to fit, content becomes unreadable).
  const baseHeight = dims?.height ?? node.scrollHeight
  const heightPx = Math.ceil(baseHeight + 32)
  console.info('[share-kit/installPdfPrintHost]', {
    nodeScrollHeight: node.scrollHeight,
    nodeClientHeight: node.clientHeight,
    cloneScrollHeight: clone.scrollHeight,
    dimsHeight: dims?.height,
    chosenHeightPx: heightPx,
  })

  const style = document.createElement('style')
  style.setAttribute('data-spool-print', '')
  style.textContent = pdfPrintCss(widthPx)
  document.head.appendChild(style)

  const filename = filenameFor(conversation, template, 'pdf')
  const origTitle = document.title
  document.title = filename

  const cleanup = () => {
    if (host.parentNode) host.parentNode.removeChild(host)
    if (style.parentNode) style.parentNode.removeChild(style)
    document.title = origTitle
  }
  return { cleanup, widthPx, heightPx, filename }
}

/**
 * Real vector PDF via the browser's print-to-PDF pipeline.
 *
 * We clone the full-size artifact into a hidden "print host" on the
 * current page, add a print-only stylesheet that:
 *   • hides everything except the host
 *   • un-positions it (override `left: -100000px`)
 *   • sets @page to match the artifact's actual dimensions
 * then call `window.print()`. The user gets a print dialog where
 * "Save as PDF" produces a vector PDF with selectable text — and the
 * dialog itself lets them rename and choose where to save.
 *
 * Setting `document.title` before printing makes Chrome default the
 * saved filename to our desired one (well-known UX hack).
 */
async function exportPdf({ node, template, conversation }: ExportArgs): Promise<void> {
  const width = node.clientWidth
  const height = node.scrollHeight

  // Clone the artifact and mount it in a print host that only becomes
  // visible inside @media print.
  const host = document.createElement('div')
  host.className = 'spool-print-host'
  host.style.cssText = 'position:fixed;left:-100000px;top:0;'
  host.appendChild(node.cloneNode(true) as HTMLElement)
  document.body.appendChild(host)

  const style = document.createElement('style')
  style.setAttribute('data-spool-print', '')
  style.textContent = `
    @media print {
      body > *:not(.spool-print-host) { display: none !important; }
      body { background: white !important; }
      .spool-print-host {
        position: static !important;
        left: auto !important;
        top: auto !important;
        width: auto !important;
      }
      .spool-print-host > * {
        box-shadow: none !important;
      }
      @page {
        size: ${width}px ${height}px;
        margin: 0;
      }
    }
  `
  document.head.appendChild(style)

  const origTitle = document.title
  document.title = filenameFor(conversation, template, 'pdf')

  const cleanup = () => {
    document.body.removeChild(host)
    document.head.removeChild(style)
    document.title = origTitle
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)

  // Let layout settle + fonts paint into the cloned node.
  await document.fonts.ready
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  window.print()
}

/**
 * Save a Blob to disk. Prefers the File System Access API so the user
 * gets a native Save dialog (pick folder, rename inline). Falls back
 * to an `<a download>` click on browsers without the API.
 *
 * User cancellation (AbortError from the picker) is silent — it means
 * they closed the dialog on purpose, not a failure.
 */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  accept: { description: string; mime: string; ext: string },
): Promise<void> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName: string
        types: Array<{ description: string; accept: Record<string, string[]> }>
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>
          close: () => Promise<void>
        }>
      }>
    }
  ).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [
          {
            description: accept.description,
            accept: { [accept.mime]: [accept.ext] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (err) {
      // User cancelled the native dialog — silent return.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Anything else (SecurityError from a user-gesture timeout after a
      // long rasterization, NotAllowedError on locked-down embeddings,
      // unknown picker failures) falls through to the <a download>
      // fallback below — the user clicked Export and expects a file,
      // not a console-only failure. Log for visibility but keep going.
      console.warn('[share-kit] File System Access save failed, falling back to <a download>:', err)
    }
  }

  // Fallback: classic invisible-link click. Lands in Downloads.
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = suggestedName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Ext = 'png' | 'pdf' | 'spool'

function filenameFor(c: Conversation, template: Template, ext: Ext): string {
  const safe = sanitizeFilename(c.title)
  const date = new Date().toISOString().slice(0, 10)
  const templateTag = template === 'chat' ? '' : ` · ${template}`
  return `${safe || 'spool'}${templateTag} · ${date}.${ext}`
}

export function filenameForExport(
  c: Conversation,
  template: Template,
  ext: 'png' | 'pdf' | 'spool',
): string {
  return filenameFor(c, template, ext)
}

/**
 * Where a save-out is going to land. Surfaces three states so callers
 * can plan the rest of the export flow: the user picked a destination
 * via the native dialog, the picker isn't available so we'll use the
 * <a download> fallback, or the user cancelled and the caller should
 * bail without writing anything.
 */
export type SaveSlot =
  | { kind: 'cancelled' }
  | { kind: 'picker'; handle: FileSystemFileHandle }
  | { kind: 'fallback' }

/**
 * Open the native Save dialog (or fall back) while the user gesture
 * is still fresh. Call this synchronously on the click handler — not
 * after a long async step — so showSaveFilePicker doesn't reject
 * with SecurityError when the gesture has timed out.
 *
 * The returned slot is paired with a later writeToSlot() once the
 * caller has a Blob ready to commit.
 */
export async function openSaveSlot(
  filename: string,
  accept: { description: string; mime: string; ext: string },
): Promise<SaveSlot> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName: string
        types: Array<{ description: string; accept: Record<string, string[]> }>
      }) => Promise<FileSystemFileHandle>
    }
  ).showSaveFilePicker
  if (!picker) return { kind: 'fallback' }
  try {
    const handle = await picker({
      suggestedName: filename,
      types: [{ description: accept.description, accept: { [accept.mime]: [accept.ext] } }],
    })
    return { kind: 'picker', handle }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'cancelled' }
    }
    console.warn('[share-kit] showSaveFilePicker failed, falling back to <a download>:', err)
    return { kind: 'fallback' }
  }
}

/**
 * Commit a previously-opened SaveSlot with a Blob. Writes through the
 * native handle when one was picked, falls back to <a download>
 * otherwise; cancelled slots are silent no-ops.
 */
export async function writeToSlot(slot: SaveSlot, blob: Blob, filename: string): Promise<void> {
  if (slot.kind === 'cancelled') return
  if (slot.kind === 'picker') {
    const writable = await slot.handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }
  // fallback: classic invisible-link click → Downloads folder
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Rasterize a DOM node to a PNG Blob without writing to disk. Use
 * together with openSaveSlot + writeToSlot when the caller wants to
 * pre-pick a destination on user gesture before running this expensive
 * rasterization step.
 */
export async function rasterizeToPngBlob(
  node: HTMLElement,
  dims?: { width: number; height: number },
  pixelRatio = 3,
): Promise<Blob> {
  await document.fonts.ready
  return renderBlob(node, pixelRatio, dims)
}
