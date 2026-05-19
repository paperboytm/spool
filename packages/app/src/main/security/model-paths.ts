// Filesystem paths + version constants for the OpenAI Privacy Filter
// model bundle. Centralised so the download / load / unload code
// agrees, and so the path appears in one place in Settings.

import { app } from 'electron'
import { join } from 'node:path'

export const PF_MODEL_ID = 'openai-privacy-filter-q4'
export const PF_MODEL_VERSION = '1.5b-q4'
/** HuggingFace repository — pinned to a specific commit at download
 *  time. Source of truth is `manifest.json` colocated with the bundle. */
export const PF_HF_REPO = 'openai/privacy-filter'

export function pfModelDir(): string {
  return join(app.getPath('userData'), 'models', PF_MODEL_ID)
}

export function pfManifestPath(): string {
  return join(pfModelDir(), 'manifest.json')
}

/** Profile segment produced when PF is enabled. Used by
 *  `currentProfileString({ pfEnabled: true, pfVersion: ... })`. */
export const PF_PROFILE_VERSION = PF_MODEL_VERSION
