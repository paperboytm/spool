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
import { createRequire } from 'node:module'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pfModelsRoot } from './model-paths.js'

/** ORT WASM/JS files are loaded by the inference renderer at runtime
 *  — by default ORT fetches them from cdn.jsdelivr.net, which the
 *  Privacy-Filter-on-device promise won't allow. Resolve onnxruntime-web's
 *  bundled `dist/` and serve those files through this protocol under
 *  the `ort/` prefix instead. transformers.js's
 *  `env.backends.onnx.wasm.wasmPaths` points back at us.
 *
 *  Lazy + memoised — `app.getPath('userData')` isn't safe pre-ready,
 *  but createRequire is. Throws if onnxruntime-web isn't in the
 *  resolution scope (would only happen if @huggingface/transformers
 *  was uninstalled). */
let ortDistRoot: string | null = null
function getOrtDistRoot(): string {
  if (ortDistRoot) return ortDistRoot
  // onnxruntime-web is a TRANSITIVE dep of @huggingface/transformers,
  // so it doesn't sit in main's direct resolution scope under pnpm
  // (which doesn't hoist by default). Resolve transformers first,
  // then resolve onnxruntime-web from transformers' own scope — that
  // path always sees it because transformers depends on it directly.
  const reqFromMain = createRequire(__filename)
  const txEntry = reqFromMain.resolve('@huggingface/transformers')
  const reqFromTx = createRequire(txEntry)
  ortDistRoot = dirname(reqFromTx.resolve('onnxruntime-web'))
  return ortDistRoot
}

const MIME_BY_EXT: Record<string, string> = {
  '.json': 'application/json',
  '.onnx': 'application/octet-stream',
  '.onnx_data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain',
  // ORT Runtime Web ships its WASM glue as ESM; dynamic import() in
  // the renderer needs the response MIME to be a recognised JS type
  // or Chromium refuses to evaluate it as a module.
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
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
    // Two distinct subspaces share this protocol:
    //   ort/<file>  → onnxruntime-web's dist (runtime binaries)
    //   <anything>  → model bundle (weights, tokenizer, config)
    // The `ort/` prefix is stripped before resolve so the join lands
    // directly inside onnxruntime-web/dist/.
    let root: string
    let target: string
    if (relPath === 'ort' || relPath.startsWith('ort/')) {
      root = getOrtDistRoot()
      target = resolve(root, relPath.slice('ort/'.length))
    } else {
      root = pfModelsRoot()
      target = resolve(root, relPath)
    }
    // Refuse anything that escapes the resolved root.
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
