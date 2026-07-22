import { isDiscoverySessionSid } from '@spool-lab/session-kit'
import { Avatar, Badge, Button } from '@spool-lab/ui'
import { CircleOff, Globe2, Link2, Users } from 'lucide-react'
import { useState } from 'react'

import { humanDate } from '../lib/dates'
import {
  updateManagedSessionVisibility,
  withdrawManagedSession,
  type HubManagementFailure,
  type ManagedSession,
  type ManagedSessionVisibility,
} from '../lib/hub-management-api'
import type { TeamSummary } from '../lib/team-api'

type VisibilityChoice =
  | { visibility: Exclude<ManagedSessionVisibility, 'team'> }
  | { visibility: 'team'; teamId: string; teamName: string }

function currentChoice(session: ManagedSession): string {
  return session.visibility === 'team' && session.team_id
    ? `team:${session.team_id}`
    : session.visibility
}

function parseChoice(value: string, teams: readonly TeamSummary[]): VisibilityChoice | null {
  if (value === 'public' || value === 'link-only') return { visibility: value }
  if (!value.startsWith('team:')) return null
  const teamId = value.slice('team:'.length)
  const team = teams.find((candidate) => candidate.id === teamId)
  return team ? { visibility: 'team', teamId: team.id, teamName: team.name } : null
}

function visibilityLabel(session: ManagedSession): string {
  if (session.visibility === 'public') return 'Public'
  if (session.visibility === 'link-only') return 'Link-only'
  return `Team · ${session.team_name || 'workspace'}`
}

function sessionTeamName(session: ManagedSession): string {
  return session.team_name || 'this Team'
}

export function visibilityConfirmation(session: ManagedSession, choice: VisibilityChoice): string {
  const title = session.title || 'this Session'

  if (choice.visibility === 'team') {
    if (session.team_id === null) {
      const discoveryImpact =
        session.visibility === 'public'
          ? ' It will be removed from Explore, Profiles, public search, RSS, and engagement rankings.'
          : ''
      return `Move “${title}” to Team · ${choice.teamName}? This transfers ownership to the Team.${discoveryImpact} Only current members can read it, and the Team keeps the Session if you later leave.`
    }
    return `Make “${title}” Team-only in ${choice.teamName}? Existing Public or Link-only access ends immediately; only current members can read it. The Session remains owned by the Team.`
  }

  if (choice.visibility === 'public') {
    const ownership = session.team_id
      ? ` It remains owned by Team · ${sessionTeamName(session)}.`
      : ''
    return `Make “${title}” Public? Anyone can read it, and it may appear in Explore, Profiles, public search, RSS, and engagement rankings.${ownership}`
  }

  const ownership = session.team_id
    ? ` It remains owned by Team · ${sessionTeamName(session)}.`
    : ''
  const discoveryImpact =
    session.visibility === 'public'
      ? ' It will be removed from Explore, Profiles, public search, RSS, and engagement rankings.'
      : ''
  return `Make “${title}” Link-only? Anyone with the URL can still read it.${discoveryImpact}${ownership}`
}

export function withdrawalConfirmation(session: ManagedSession): string {
  const title = session.title || 'this Session'
  if (session.team_id) {
    return `Withdraw “${title}” from Team · ${sessionTeamName(session)}? This permanently removes the Team Session from the workspace and all public surfaces. Its URL will return 410 Gone, every member loses access, and changing visibility cannot restore it. No member can revive it by submitting a new Session head. Copies already made remain outside Spool's control.`
  }
  return `Withdraw “${title}”? This immediately removes the current hosted copy from Spool and all public surfaces, and its URL will return 410 Gone. Changing visibility cannot restore it, but as the author you can explicitly Share this Session again later. Copies already made remain outside Spool's control.`
}

function failureMessage(result: HubManagementFailure): string {
  if (result.kind === 'forbidden') return result.detail ?? 'You cannot change this Session.'
  if (result.kind === 'not-found')
    return 'This Session is unavailable or you no longer have access.'
  if (result.kind === 'gone') return result.detail ?? 'This Session has been withdrawn.'
  if (result.kind === 'conflict') return result.detail ?? 'That ownership change is not available.'
  if (result.kind === 'invalid') return result.detail ?? 'That visibility is not available.'
  if (result.kind === 'rate-limited') return 'Too many changes. Wait a moment and try again.'
  return 'Could not change visibility. Try again.'
}

export function withdrawalFailureMessage(result: HubManagementFailure): string {
  if (result.kind === 'forbidden') return result.detail ?? 'You cannot withdraw this Session.'
  if (result.kind === 'not-found') {
    return 'This Session is unavailable or you no longer have access.'
  }
  if (result.kind === 'gone') return result.detail ?? 'This Session has already been withdrawn.'
  if (result.kind === 'rate-limited') return 'Too many attempts. Wait a moment and try again.'
  return 'Could not withdraw this Session. Try again.'
}

export function withoutManagedSession<T extends Pick<ManagedSession, 'sid'>>(
  sessions: readonly T[],
  sid: string,
): T[] {
  return sessions.filter((session) => session.sid !== sid)
}

function sessionTeams(session: ManagedSession, teams: readonly TeamSummary[]): TeamSummary[] {
  if (!session.team_id) return [...teams]
  const current = teams.find((team) => team.id === session.team_id)
  if (current) return [current]
  return [
    {
      id: session.team_id,
      name: session.team_name || 'Team workspace',
      permissions: [],
    },
  ]
}

export function canManageSession(
  session: ManagedSession,
  teams: readonly TeamSummary[],
  surfaceAllowsManagement: boolean,
): boolean {
  if (!surfaceAllowsManagement || !session.can_manage_visibility) return false
  if (!session.team_id) return true

  // A personal author may transfer their Session into any Team they belong to,
  // but once the Team owns it only an Owner/Admin may manage disclosure. Gate
  // the row with the current Team projection as well as the per-Session bit so
  // a stale mutation response cannot briefly expose actions to a Member.
  return (
    teams.find((team) => team.id === session.team_id)?.permissions.includes('sessions:manage') ??
    false
  )
}

export function canPublishManagedSession(session: ManagedSession): boolean {
  // Preserve a historical Public value so the controlled select remains
  // representable, but never offer a new Public transition that the Hub will
  // reject for providers not supported by Explore.
  return session.visibility === 'public' || isDiscoverySessionSid(session.sid)
}

export function ManagedSessionList({
  sessions,
  teams,
  canManageVisibility,
  onSessionChanged,
  onSessionWithdrawn,
}: {
  sessions: ManagedSession[]
  teams: readonly TeamSummary[]
  canManageVisibility: boolean
  onSessionChanged: (session: ManagedSession) => void
  onSessionWithdrawn: (sid: string) => void
}) {
  return (
    <ul className="sw-managed-session-list">
      {sessions.map((session) => (
        <ManagedSessionRow
          key={session.sid}
          session={session}
          teams={sessionTeams(session, teams)}
          canManageVisibility={canManageVisibility}
          onSessionChanged={onSessionChanged}
          onSessionWithdrawn={onSessionWithdrawn}
        />
      ))}
    </ul>
  )
}

function ManagedSessionRow({
  session,
  teams,
  canManageVisibility,
  onSessionChanged,
  onSessionWithdrawn,
}: {
  session: ManagedSession
  teams: readonly TeamSummary[]
  canManageVisibility: boolean
  onSessionChanged: (session: ManagedSession) => void
  onSessionWithdrawn: (sid: string) => void
}) {
  const [busy, setBusy] = useState<'idle' | 'visibility' | 'withdraw'>('idle')
  const [error, setError] = useState<string | null>(null)
  const authorName = session.author.display_name || session.author.handle || 'Team member'

  async function changeVisibility(value: string) {
    const choice = parseChoice(value, teams)
    if (!choice || value === currentChoice(session) || busy !== 'idle') return
    if (!window.confirm(visibilityConfirmation(session, choice))) return

    setBusy('visibility')
    setError(null)
    const result = await updateManagedSessionVisibility(
      session.sid,
      choice.visibility,
      choice.visibility === 'team' ? choice.teamId : undefined,
    )
    setBusy('idle')
    if (result.kind === 'unauthenticated') {
      const next = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`)
      return
    }
    if (result.kind !== 'ok') {
      setError(failureMessage(result))
      return
    }
    onSessionChanged(result.data.session)
  }

  async function withdraw() {
    if (busy !== 'idle' || !window.confirm(withdrawalConfirmation(session))) return

    setBusy('withdraw')
    setError(null)
    const result = await withdrawManagedSession(session.sid)
    setBusy('idle')
    if (result.kind === 'unauthenticated') {
      const next = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`)
      return
    }
    if (result.kind === 'gone') {
      onSessionWithdrawn(session.sid)
      return
    }
    if (result.kind !== 'ok') {
      setError(withdrawalFailureMessage(result))
      return
    }
    onSessionWithdrawn(session.sid)
  }

  return (
    <li>
      <div className="sw-managed-session-row">
        <a className="sw-managed-session-link" href={`/session/${encodeURIComponent(session.sid)}`}>
          <div className="sw-managed-session-titleline">
            <h3>{session.title || 'Shared session'}</h3>
            <VisibilityBadge session={session} />
          </div>
          {session.summary ? <p>{session.summary}</p> : null}
          <div className="sw-managed-session-meta">
            <Avatar src={session.author.avatar_url} name={authorName} alt="" size="sm" />
            <span>{authorName}</span>
            <span aria-hidden="true">·</span>
            <span>{session.provider}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(session.updated_at).toISOString()}>
              updated {humanDate(session.updated_at)}
            </time>
          </div>
        </a>

        {canManageSession(session, teams, canManageVisibility) ? (
          <div className="sw-managed-session-actions" aria-busy={busy !== 'idle' || undefined}>
            <label className="sw-managed-session-visibility">
              <span>{busy === 'visibility' ? 'Updating…' : 'Visibility'}</span>
              <select
                value={currentChoice(session)}
                disabled={busy !== 'idle'}
                aria-label={`Visibility for ${session.title || 'Shared session'}`}
                onChange={(event) => void changeVisibility(event.target.value)}
              >
                {canPublishManagedSession(session) ? <option value="public">Public</option> : null}
                <option value="link-only">Link-only</option>
                {teams.map((team) => (
                  <option key={team.id} value={`team:${team.id}`}>
                    Team · {team.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="sw-managed-session-withdraw sw-team-danger-button"
              disabled={busy !== 'idle'}
              onClick={() => void withdraw()}
            >
              <CircleOff size={14} strokeWidth={1.8} aria-hidden="true" />
              {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
            </Button>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="sw-managed-session-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  )
}

function VisibilityBadge({ session }: { session: ManagedSession }) {
  const Icon =
    session.visibility === 'public' ? Globe2 : session.visibility === 'team' ? Users : Link2
  return (
    <Badge title={visibilityLabel(session)}>
      <Icon size={12} strokeWidth={1.7} aria-hidden="true" />
      {visibilityLabel(session)}
    </Badge>
  )
}
