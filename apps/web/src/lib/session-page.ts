// Pure page logic for the v2 session reader — everything here is
// string-in/value-out so the fallback chains and deep links test in node.

import { isSessionProvider, type SessionProvider } from '@spool-lab/session-kit'

import { resumeBootstrapCommand } from './cli-command'
import type { HubSessionMeta } from './hub-api'

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

/** `#r/<idx>` deep link (design §5 layer 3). */
export function deepLinkIndex(hash: string): number | null {
  const match = hash.match(/^#r\/(\d{1,7})$/)
  if (!match) return null
  return Number(match[1])
}

export function deepLinkHash(index: number): string {
  return `#r/${index}`
}

/** Bootstrap the CLI and resume against this reader's spool.new Session id.
 * The install pipeline finishes before the caller's shell launches Resume,
 * preserving the terminal TTY for the native agent. */
export function resumeCommandFor(sid: string): string {
  return resumeBootstrapCommand(sid)
}

/** Turn the fetch remote recorded in a workspace card into a browser link.
 * Local paths stay plain text because they have no meaningful public target. */
export function repositoryUrlForRemote(remote: string): string | null {
  const separator = remote.indexOf(': ')
  if (separator <= 0) return null

  const gitUrl = remote.slice(separator + 2).trim()
  let browserUrl: string

  if (/^https?:\/\//i.test(gitUrl)) {
    browserUrl = gitUrl
  } else if (/^(?:ssh|git):\/\//i.test(gitUrl)) {
    try {
      const parsed = new URL(gitUrl)
      browserUrl = `https://${parsed.host}${parsed.pathname}`
    } catch {
      return null
    }
  } else {
    const scpStyle = gitUrl.match(/^(?:[^@\s/]+@)?([^:/\s]+):(.+)$/)
    if (!scpStyle) return null
    browserUrl = `https://${scpStyle[1]}/${scpStyle[2]}`
  }

  try {
    const parsed = new URL(browserUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname === '/') return null
    parsed.pathname = parsed.pathname.replace(/\.git\/?$/, '')
    return parsed.toString()
  } catch {
    return null
  }
}

export function providerOf(sid: string): SessionProvider {
  const provider = sid.slice(0, sid.indexOf('_'))
  if (!isSessionProvider(provider)) throw new Error(`Unsupported session provider in ${sid}`)
  return provider
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
