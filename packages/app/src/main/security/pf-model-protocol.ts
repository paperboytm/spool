// Custom `pf-model://` protocol — serves files from pfModelDir() to
// the hidden inference renderer.
//
// Why not file://: with sandbox=true the inference renderer can't read
// arbitrary file:// URLs, and weakening webPreferences just to load a
// local model would be a bigger compromise than registering one
// narrow protocol that ONLY answers for paths under pfModelDir().
//
// transformers.js issues fetches against `${env.localModelPath}/${modelId}/${file}`,
// so we treat any pf-model:// path as a relative join against the
// model directory and refuse to escape it.

import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pfModelsRoot } from './model-paths.js'

const MIME_BY_EXT: Record<string, string> = {
  '.json': 'application/json',
  '.onnx': 'application/octet-stream',
  '.onnx_data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain',
}

function mimeForPath(path: string): string {
  const m = path.match(/\.[^./]+$/)
  return (m && MIME_BY_EXT[m[0].toLowerCase()]) || 'application/octet-stream'
}

let registered = false

export function registerPfModelProtocol(): void {
  if (registered) return
  registered = true
  protocol.handle('pf-model', async (req) => {
    const url = new URL(req.url)
    // With `standard: true` Chromium treats the first path segment
    // after `://` as a HOST. transformers.js fetches
    // `pf-model:///openai-privacy-filter-q4/config.json` — Electron
    // collapses `///` and parses it as host=`openai-privacy-filter-q4`,
    // pathname=`/config.json`. We need the full "host + path" to
    // resolve back to the real file location.
    // Decode %20 etc. so paths with spaces (Spool DEV's userData
    // sits under "Application Support") don't mis-resolve.
    const combined = (url.host ? `/${url.host}` : '') + url.pathname
    const relPath = decodeURIComponent(combined).replace(/^\/+/, '')
    const root = pfModelsRoot()
    const target = resolve(root, relPath)
    // Refuse anything that escapes the models parent directory.
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    try {
      const s = await stat(target)
      // Stream large weight files (917 MB onnx_data) instead of
      // buffering — net.fetch(file://) chokes on path encoding in
      // app.getPath('userData') (paths containing spaces).
      const nodeStream = createReadStream(target)
      // Cast to ReadableStream<Uint8Array> — Node's Readable is
      // compatible with the Web Streams API surface that fetch needs.
      const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': mimeForPath(target),
          'Content-Length': String(s.size),
        },
      })
    } catch (err) {
      console.error('[pf-model] read failed', target, err)
      return new Response('not found', { status: 404 })
    }
  })
}

/** electron.protocol can ONLY be called before app.ready, so the
 *  scheme has to be marked privileged at import time. Otherwise the
 *  renderer treats `pf-model://` as an opaque origin and CSP/fetch
 *  reject it silently. */
export function registerPfModelScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'pf-model',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      // The inference renderer is loaded from http://localhost in dev
      // (Vite) and file:// in prod; either way the document origin
      // differs from pf-model:// so Chromium's CORS layer would block
      // the fetch without explicit allow. Our handler only serves files
      // inside pfModelsRoot() (path-traversal refused with 403), no
      // sensitive surface to widen.
      corsEnabled: true,
      bypassCSP: false,
      stream: true,
    },
  }])
}
