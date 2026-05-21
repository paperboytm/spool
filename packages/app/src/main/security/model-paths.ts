// Filesystem paths + version constants for the Privacy Filter ONNX
// model bundle. Centralised so download / load / unload code agrees
// and the directory shows up in one place in Settings.

import { app } from 'electron'
import { join } from 'node:path'

/** Directory name under userData/models/. Bumped any time the model
 *  changes — the scan profile string keys off PF_PROFILE_VERSION so
 *  a model swap forces a full rescan. */
export const PF_MODEL_ID = 'openai-privacy-filter-q4'
export const PF_MODEL_VERSION = '1.5b-q4'
/** HuggingFace repository — pinned to a specific commit at download
 *  time. transformers.js loads the model files via the pf-model://
 *  protocol against the local copy; this URL is only used by the
 *  downloader, never by the inference renderer. */
export const PF_HF_REPO = 'openai/privacy-filter'

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

/** Profile segment produced when PF is enabled. Used by
 *  `currentProfileString({ pfEnabled: true, pfVersion: ... })`.
 *  Tracked independently of PF_MODEL_VERSION so tuning the
 *  class-mapping (precision/recall tradeoffs, suppressed classes)
 *  can force a backfill rescan without re-downloading weights.
 *  Bump suffix when scan-result shape would meaningfully differ:
 *    r1 — initial release (all 8 classes considered)
 *    r2 — 2026-05-21: restricted to email/phone/dob/secret-boost;
 *         person/address/url/account dropped due to OOD precision */
export const PF_PROFILE_VERSION = `${PF_MODEL_VERSION}.r2`
