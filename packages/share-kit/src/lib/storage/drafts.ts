// Tier 1 storage — auto-save drafts to IndexedDB so the editor survives
// reloads. Never leaves the browser.

import { get, set, del, keys } from 'idb-keyval'

import type { Conversation, EditorOpts } from '../types'
import { normalizeOpts } from '../types'

export interface Draft {
  id: string
  conversation: Conversation
  opts: EditorOpts
  updatedAt: number
}

const PREFIX = 'spool:draft:'
const CURRENT_KEY = 'spool:draft:current'

/** Pass every loaded draft through normalizeOpts so stale enum values
 *  (e.g. a template key we've since renamed) can't blow up the UI. */
function hydrate(d: Draft | undefined): Draft | undefined {
  if (!d) return d
  return { ...d, opts: normalizeOpts(d.opts) }
}

export async function saveDraft(draft: Draft): Promise<void> {
  await set(PREFIX + draft.id, draft)
  await set(CURRENT_KEY, draft.id)
}

export async function loadDraft(id: string): Promise<Draft | undefined> {
  return hydrate(await get<Draft>(PREFIX + id))
}

export async function loadCurrentDraft(): Promise<Draft | undefined> {
  const id = await get<string>(CURRENT_KEY)
  if (!id) return undefined
  return await loadDraft(id)
}

export async function listDrafts(): Promise<Draft[]> {
  const ks = await keys()
  const draftKeys = ks.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(PREFIX) && k !== CURRENT_KEY,
  )
  const drafts = await Promise.all(draftKeys.map((k) => get<Draft>(k)))
  return drafts
    .map(hydrate)
    .filter((d): d is Draft => d !== undefined)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteDraft(id: string): Promise<void> {
  await del(PREFIX + id)
}

/** Stable id for a conversation. Successive opens of the same source
 *  reuse the id so we update one draft instead of accumulating many. */
export function draftIdFor(conversation: Conversation): string {
  if (conversation.shareUrl) return `paste:${conversation.shareUrl}`
  if (conversation.origin.kind === 'file') {
    return `file:${conversation.origin.filename}`
  }
  return `untitled:${conversation.title}`
}
