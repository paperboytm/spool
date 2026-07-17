// Filesystem paths for the Privacy Filter ONNX model bundle. Centralised
// so download / load / unload code agrees and the directory shows up in
// one place in Settings.
//
// Pure version + repo constants live in pf-version.ts so worker threads
// can read them without dragging this file's `electron` import into the
// worker chunk.

import { app } from 'electron'
import { join } from 'node:path'
import { PF_MODEL_ID } from './pf-version.js'

export { PF_MODEL_ID, PF_MODEL_VERSION, PF_HF_REPO, PF_PROFILE_VERSION } from './pf-version.js'

/** Parent directory for all model bundles. transformers.js fetches
 *  files at `${env.localModelPath}/${modelId}/${file}`, so the
 *  protocol resolves relative to this and not to the model-specific
 *  subdirectory. */
export function pfModelsRoot(): string {
  return join(app.getPath('userData'), 'models')
}

export function pfModelDir(): string {
  return join(pfModelsRoot(), PF_MODEL_ID)
}

export function pfManifestPath(): string {
  return join(pfModelDir(), 'manifest.json')
}
