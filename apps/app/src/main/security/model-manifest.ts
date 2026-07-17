// Pinned Privacy Filter model manifest.
//
// SOURCE OF TRUTH: this file declares which files we download, where
// from, and what SHA-256 they MUST match. The downloader refuses to
// keep a file whose hash disagrees with the manifest, so a CDN swap
// or MITM that returns a tampered weight file is caught before the
// inference window ever loads it.
//
// MODEL: openai/privacy-filter (Apache 2.0, 1.5B params / 50M active
// MoE, 8-class PII token classifier with Viterbi span decoding).
// Outputs entity_group strings prefixed `private_` (e.g. private_email)
// plus the unprefixed `account_number` and `secret` classes — see
// class-mapping.ts for the kind mapping.
//
// To update the model:
//   1. bump PF_HF_REPO + PF_MODEL_ID + PF_PROFILE_VERSION in model-paths.ts
//   2. regenerate the per-file sha256s against the new commit
//   3. update class-mapping.ts if the label set changed

import { PF_HF_REPO } from './pf-version.js'

export interface ManifestFile {
  /** Relative path inside the model directory + the path the file is
   *  fetched at on huggingface.co/<repo>/resolve/<commit>/<this>. */
  path: string
  /** Lowercase hex SHA-256 of the complete file. */
  sha256: string
  /** Expected file size in bytes — used as a progress denominator and
   *  to short-circuit obviously truncated resumes. */
  sizeBytes: number
}

export interface ModelManifest {
  hfRepo: string
  /** Pinned commit hash on HF. Must be a 40-char SHA. */
  hfCommit: string
  /** Files to fetch, in download order. */
  files: ReadonlyArray<ManifestFile>
}

export const MODEL_MANIFEST: ModelManifest = {
  hfRepo: PF_HF_REPO,
  hfCommit: '7ffa9a043d54d1be65afb281eddf0ffbe629385b',
  files: [
    { path: 'config.json',              sha256: 'b2b26a4a4a000639ad30b0c264adbefe365bdb567fbd7bb27303b8c438375bd1', sizeBytes: 3039 },
    { path: 'tokenizer.json',           sha256: '0614fe83cadab421296e664e1f48f4261fa8fef6e03e63bb75c20f38e37d07d3', sizeBytes: 27868174 },
    { path: 'tokenizer_config.json',    sha256: '6c14af9ce1a284d3c3c5146b26efe4cd589c68e1dd4e9d94455606ec911ba774', sizeBytes: 234 },
    { path: 'viterbi_calibration.json', sha256: 'bbc8611ef08a55ed72d64856cbbbb9a91db8dfa881f0a92e2afbad6e4bbc775a', sizeBytes: 372 },
    { path: 'onnx/model_q4.onnx',       sha256: '8f7dee8b46d096f052b359375dfba5d983cc4d18c44a783bf548615c472f8dea', sizeBytes: 160219 },
    // Weights spill into an external `.onnx_data` file when the ONNX
    // graph exceeds protobuf's 2 GB limit. transformers.js loads it
    // automatically as long as it sits next to the .onnx graph.
    { path: 'onnx/model_q4.onnx_data',  sha256: 'f30998e28c71c5374cc7e8b7de8f0f83e981592c0c2d652d2ad4928454dbb496', sizeBytes: 917120144 },
  ],
}

export function manifestTotalBytes(manifest: ModelManifest): number {
  return manifest.files.reduce((sum, f) => sum + f.sizeBytes, 0)
}

export function manifestFileUrl(manifest: ModelManifest, file: ManifestFile): string {
  return `https://huggingface.co/${manifest.hfRepo}/resolve/${manifest.hfCommit}/${file.path}`
}
