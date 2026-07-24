import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import type { HubCredentialOptions } from './hub/credentials.js'

// A subscription marks a project directory whose Sessions — including those
// recorded from its git worktrees — publish automatically on every sync. The
// visibility decision is made once, at subscribe time, so continuous syncing
// never has to prompt again.

export interface Subscription {
  /** Absolute, symlink-resolved directory path. */
  path: string
  /** 'provider-default' follows the Public/Link-only provider rules. */
  visibility: 'provider-default' | 'link-only'
  addedAt: string
}

interface SubscriptionsFile {
  version: 1
  subscriptions: Subscription[]
}

export function subscriptionsPath(options: HubCredentialOptions = {}): string {
  const env = options.env ?? process.env
  const home = options.homeDir ?? nonEmpty(env['HOME']) ?? homedir()
  return join(home, '.spool', 'subscriptions.json')
}

export function loadSubscriptions(options: HubCredentialOptions = {}): Subscription[] {
  const path = subscriptionsPath(options)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Invalid subscriptions file at ${path}: ${message}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['subscriptions'])) {
    throw new Error(`Invalid subscriptions file at ${path}: expected { subscriptions: [] }`)
  }
  return parsed['subscriptions'].map((value, index) => parseSubscription(value, index, path))
}

export function saveSubscriptions(
  subscriptions: readonly Subscription[],
  options: HubCredentialOptions = {},
): string {
  const path = subscriptionsPath(options)
  const stored: SubscriptionsFile = { version: 1, subscriptions: [...subscriptions] }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  return path
}

/** Resolve a user-supplied directory to the canonical form stored in a
 *  subscription. Throws when the path does not exist or is not a directory. */
export function canonicalSubscriptionPath(input: string, cwd: string = process.cwd()): string {
  const absolute = isAbsolute(input) ? input : resolve(cwd, input)
  const canonical = realpathSync(absolute)
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`Not a directory: ${canonical}`)
  }
  return canonical
}

export function addSubscription(
  subscription: Subscription,
  options: HubCredentialOptions = {},
): { added: boolean; subscriptions: Subscription[] } {
  const existing = loadSubscriptions(options)
  const found = existing.find((entry) => entry.path === subscription.path)
  if (found) {
    if (found.visibility === subscription.visibility) {
      return { added: false, subscriptions: existing }
    }
    const updated = existing.map((entry) =>
      entry.path === subscription.path ? { ...entry, visibility: subscription.visibility } : entry,
    )
    saveSubscriptions(updated, options)
    return { added: false, subscriptions: updated }
  }
  const updated = [...existing, subscription]
  saveSubscriptions(updated, options)
  return { added: true, subscriptions: updated }
}

export function removeSubscription(
  path: string,
  options: HubCredentialOptions = {},
): { removed: boolean; subscriptions: Subscription[] } {
  const existing = loadSubscriptions(options)
  const remaining = existing.filter((entry) => entry.path !== path)
  if (remaining.length === existing.length) return { removed: false, subscriptions: existing }
  saveSubscriptions(remaining, options)
  return { removed: true, subscriptions: remaining }
}

function parseSubscription(value: unknown, index: number, path: string): Subscription {
  if (!isRecord(value) || typeof value['path'] !== 'string' || value['path'].trim() === '') {
    throw new Error(`Invalid subscriptions file at ${path}: entry ${index} has no path`)
  }
  const visibility = value['visibility'] === 'link-only' ? 'link-only' : 'provider-default'
  const addedAt = typeof value['addedAt'] === 'string' ? value['addedAt'] : ''
  return { path: value['path'], visibility, addedAt }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error
}
