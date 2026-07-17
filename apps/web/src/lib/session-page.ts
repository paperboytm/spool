// Pure page logic for the v2 session reader — everything here is
// string-in/value-out so the fallback chains and deep links test in node.

import type { HubSessionMeta } from './hub-api'
import type { SessionViewV1 } from '@spool-lab/session-kit'

/** First-screen self-description, three-level degradation (design §5). */
export type NoteDisplay =
  | { kind: 'note'; note: string }
  | { kind: 'last-reply'; lastReply: string }
  | { kind: 'prompt-and-reply'; firstPrompt: string; lastReply: string }
  | { kind: 'none' }

export function noteDisplayFor(
  noteMd: string | null,
  view: SessionViewV1 | null,
): NoteDisplay {
  const note = noteMd?.trim()
  if (note) return { kind: 'note', note }
  const lastReply = view?.lastReply.trim() ?? ''
  const firstPrompt = view?.firstPrompt.trim() ?? ''
  if (lastReply && firstPrompt) return { kind: 'prompt-and-reply', firstPrompt, lastReply }
  if (lastReply) return { kind: 'last-reply', lastReply }
  if (firstPrompt) return { kind: 'prompt-and-reply', firstPrompt, lastReply: '' }
  return { kind: 'none' }
}

export interface WorkspaceCardDisplay {
  remotes: string[]
  branch: string | null
  head: string | null
  dirty: string[]
  observed: string | null
}

export function parseWorkspaceCard(cardJson: string | null): WorkspaceCardDisplay | null {
  if (!cardJson) return null
  try {
    const parsed = JSON.parse(cardJson) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      remotes: stringArray(parsed['remotes']),
      branch: stringOrNull(parsed['branch']),
      head: stringOrNull(parsed['head']),
      dirty: stringArray(parsed['dirty']),
      observed: stringOrNull(parsed['observed']),
    }
  } catch {
    return null
  }
}

export interface LineageDisplay {
  sid: string
  position: number
  url: string | null
}

export function parseLineage(lineageJson: string | null): LineageDisplay | null {
  if (!lineageJson) return null
  try {
    const parsed = JSON.parse(lineageJson) as { source?: { sid?: unknown; position?: unknown; url?: unknown } }
    const source = parsed.source
    if (!source || typeof source.sid !== 'string' || typeof source.position !== 'number') return null
    return {
      sid: source.sid,
      position: source.position,
      url: typeof source.url === 'string' ? source.url : null,
    }
  } catch {
    return null
  }
}

/** `#r/<idx>` deep link (design §5 layer 3). */
export function deepLinkIndex(hash: string): number | null {
  const match = hash.match(/^#r\/(\d{1,7})$/)
  if (!match) return null
  return Number(match[1])
}

export function deepLinkHash(index: number): string {
  return `#r/${index}`
}

/** The sid alone resumes against the reader's configured hub (spool.pro
 *  by default) — shorter to copy than the full page URL, which stays
 *  accepted by the CLI for cross-hub cases. */
export function resumeCommandFor(sid: string): string {
  return `spool resume ${sid}`
}

export function providerOf(sid: string): 'claude' | 'codex' {
  return sid.startsWith('codex_') ? 'codex' : 'claude'
}

export function authorLabel(meta: HubSessionMeta): string {
  if (meta.author.handle) return `@${meta.author.handle}`
  return meta.author.displayName ?? 'Someone'
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
