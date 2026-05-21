// Pure filesystem inspection of the Privacy Filter model bundle.
// Never downloads.

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelManifest } from './model-manifest.js'

export type PfInstallStatus =
  | { status: 'not-installed' }
  | { status: 'partial'; bytesPresent: number; bytesTotal: number }
  | { status: 'installed' }

export function pfInstallStatus(modelDir: string, manifest: ModelManifest): PfInstallStatus {
  let bytesPresent = 0
  let bytesTotal = 0
  let allInstalled = true
  for (const file of manifest.files) {
    bytesTotal += file.sizeBytes
    const full = join(modelDir, file.path)
    const part = `${full}.part`
    if (fileMatches(full, file.sha256, file.sizeBytes)) {
      bytesPresent += file.sizeBytes
      continue
    }
    allInstalled = false
    // Count partial bytes so the progress dial survives a restart.
    try {
      bytesPresent += statSync(part).size
    } catch { /* no .part */ }
  }
  if (allInstalled) return { status: 'installed' }
  if (bytesPresent === 0) return { status: 'not-installed' }
  return { status: 'partial', bytesPresent, bytesTotal }
}

function fileMatches(path: string, expectedSha256: string, expectedSize: number): boolean {
  try {
    const stat = statSync(path)
    if (stat.size !== expectedSize) return false
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
    return hash === expectedSha256
  } catch {
    return false
  }
}
