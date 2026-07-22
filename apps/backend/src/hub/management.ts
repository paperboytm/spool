import type { D1Database } from '@cloudflare/workers-types'

import { isPublishedToDiscovery } from '../discovery/projection'
import { getHubAuthor, type HubSessionRow } from './store'

export type ManagedHubSession = {
  sid: string
  title: string
  summary: string | null
  provider: string
  created_at: number
  updated_at: number
  visibility: 'public' | 'link-only' | 'team'
  team_id: string | null
  team_name: string | null
  can_manage_visibility: boolean
  author: {
    handle: string | null
    display_name: string | null
    avatar_url: string | null
  }
}

export async function listOwnerHubSessions(
  db: D1Database,
  userId: string,
): Promise<ManagedHubSession[]> {
  const rows = await db
    .prepare(
      'SELECT s.*, t.name AS team_name, m.role AS team_role FROM hub_sessions s ' +
        'LEFT JOIN teams t ON t.id=s.team_id ' +
        'LEFT JOIN team_memberships m ON m.team_id=s.team_id AND m.user_id=? ' +
        'WHERE s.owner_user_id=? AND s.withdrawn_at IS NULL ' +
        'AND (s.team_id IS NULL OR (m.user_id IS NOT NULL AND t.archived_at IS NULL)) ' +
        'ORDER BY s.updated_at DESC LIMIT 200',
    )
    .bind(userId, userId)
    .all<HubSessionRow & { team_name: string | null; team_role: string | null }>()
  return Promise.all(
    rows.results.map((row) =>
      serializeManagedSession(
        db,
        row,
        row.team_id === null || row.team_role === 'owner' || row.team_role === 'admin',
      ),
    ),
  )
}

export async function listTeamHubSessions(
  db: D1Database,
  teamId: string,
  canManageVisibility: boolean,
): Promise<ManagedHubSession[]> {
  const rows = await db
    .prepare(
      'SELECT s.*, t.name AS team_name FROM hub_sessions s ' +
        'JOIN teams t ON t.id=s.team_id WHERE s.team_id=? AND s.withdrawn_at IS NULL ' +
        'ORDER BY s.updated_at DESC LIMIT 200',
    )
    .bind(teamId)
    .all<HubSessionRow & { team_name: string | null }>()
  return Promise.all(
    rows.results.map((row) => serializeManagedSession(db, row, canManageVisibility)),
  )
}

export async function serializeManagedSession(
  db: D1Database,
  row: HubSessionRow & { team_name?: string | null },
  canManageVisibility = true,
): Promise<ManagedHubSession> {
  const [author, published] = await Promise.all([
    getHubAuthor(db, row.owner_user_id),
    row.visibility === 'unlisted' ? isPublishedToDiscovery(db, row.sid) : Promise.resolve(false),
  ])
  return {
    sid: row.sid,
    title: sessionTitle(row),
    summary: row.note_md,
    provider: row.sid.slice(0, row.sid.indexOf('_')),
    created_at: row.created_at,
    updated_at: row.updated_at,
    visibility:
      row.visibility === 'private' && row.team_id ? 'team' : published ? 'public' : 'link-only',
    team_id: row.team_id ?? null,
    team_name: row.team_name ?? null,
    can_manage_visibility: canManageVisibility,
    author: {
      handle: author.handle,
      display_name: author.displayName,
      avatar_url: author.avatarUrl,
    },
  }
}

function sessionTitle(row: Pick<HubSessionRow, 'sid' | 'card_json' | 'note_md'>): string {
  if (row.card_json) {
    try {
      const card = JSON.parse(row.card_json) as { title?: unknown; workspace?: unknown }
      if (typeof card.title === 'string' && card.title.trim())
        return card.title.trim().slice(0, 200)
      if (typeof card.workspace === 'string' && card.workspace.trim()) {
        return card.workspace.trim().slice(0, 200)
      }
    } catch {
      // Fall through to authored Summary/provider fallback.
    }
  }
  if (row.note_md) {
    for (const line of row.note_md.split(/\r?\n/)) {
      const plain = line.replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-+*]\s+)/, '').trim()
      if (plain && !['summary', 'outcome', 'overview'].includes(plain.toLowerCase())) {
        return plain.slice(0, 200)
      }
    }
  }
  const provider = row.sid.slice(0, row.sid.indexOf('_'))
  return `${provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex CLI' : provider} session`
}
