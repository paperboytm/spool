import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ProjectIdentity } from '../types.js'

// Resolved at call time so process.env.HOME overrides take effect in tests.
function getHome(): string {
  return process.env['HOME'] || homedir()
}

/**
 * Collapses sessions whose cwd is a known "scratch workspace" pattern into a
 * single synthetic project — the workspace dir itself carries no useful
 * identity signal (no .git, no manifest), so without this each chat shows up
 * as its own sidebar entry.
 *
 * Each synthesizer matches a cwd and returns a stable identity shared by all
 * sessions in that scope. Returns null to defer to the next rule.
 */
export interface IdentitySynthesizer {
  name: string
  synthesize(cwd: string): ProjectIdentity | null
}

/**
 * Codex desktop creates one disposable workspace per non-project chat at
 * `~/Documents/Codex/<YYYY-MM-DD>/<slug>/`. Group every such chat under a
 * single synthetic "Codex" project so they don't litter the sidebar.
 */
export const codexScratchSynthesizer: IdentitySynthesizer = {
  name: 'codex-scratch',
  synthesize(cwd: string): ProjectIdentity | null {
    const root = join(getHome(), 'Documents', 'Codex')
    if (!cwd.startsWith(root + '/')) return null
    return {
      kind: 'synthetic',
      key: 'codex:scratch',
      displayName: 'Codex Chats',
      displayPath: root,
    }
  },
}

export const DEFAULT_SYNTHESIZERS: readonly IdentitySynthesizer[] = Object.freeze([
  codexScratchSynthesizer,
])
