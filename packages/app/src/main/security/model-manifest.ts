// Pinned Privacy Filter model manifest. The downloader refuses to
// keep a file whose hash disagrees with the per-file sha256, so a CDN
// swap or MITM that returns a tampered weight file is caught before
// the inference window ever loads it.
//
// To update: bump hfCommit, regenerate each sha256 with `shasum -a
// 256`, bump PF_MODEL_VERSION in model-paths.ts (scan_profile keys
// off it). Real values get pinned pre-GA — see
// project_security_scan_feature memory.

import { PF_HF_REPO } from './model-paths.js'

export interface ManifestFile {
  path: string
  sha256: string
  sizeBytes: number
}

export interface ModelManifest {
  hfRepo: string
  hfCommit: string
  files: ReadonlyArray<ManifestFile>
}

export const MODEL_MANIFEST: ModelManifest = {
  hfRepo: PF_HF_REPO,
  hfCommit: '0000000000000000000000000000000000000000',
  files: [
    {
      path: 'onnx/model_quantized.onnx',
      sha256: '0'.repeat(64),
      sizeBytes: 800_000_000,
    },
    {
      path: 'tokenizer.json',
      sha256: '0'.repeat(64),
      sizeBytes: 2_500_000,
    },
    {
      path: 'config.json',
      sha256: '0'.repeat(64),
      sizeBytes: 1_500,
    },
  ],
}

export function manifestTotalBytes(manifest: ModelManifest): number {
  return manifest.files.reduce((sum, f) => sum + f.sizeBytes, 0)
}

export function manifestFileUrl(manifest: ModelManifest, file: ManifestFile): string {
  return `https://huggingface.co/${manifest.hfRepo}/resolve/${manifest.hfCommit}/${file.path}`
}
