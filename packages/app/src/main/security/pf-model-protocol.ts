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

import { protocol, net } from 'electron'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pfModelsRoot } from './model-paths.js'

let registered = false

export function registerPfModelProtocol(): void {
  if (registered) return
  registered = true
  protocol.handle('pf-model', async (req) => {
    const url = new URL(req.url)
    // Strip leading slashes from the path so `pf-model:///foo/bar.bin`
    // resolves under pfModelsRoot(), not the filesystem root.
    const relPath = url.pathname.replace(/^\/+/, '')
    const root = pfModelsRoot()
    const target = resolve(root, relPath)
    // Refuse anything that escapes the models parent directory.
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
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
      bypassCSP: false,
      stream: true,
    },
  }])
}
