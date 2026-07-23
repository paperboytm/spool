import { Avatar, Badge, Button, SectionLabel, Tabs } from '@spool-lab/ui'
import {
  Archive,
  Clock3,
  MailPlus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { Footer, Header, Page } from '../components/Chrome'
import { ManagedSessionList, withoutManagedSession } from '../components/ManagedSessionList'
import { humanDate } from '../lib/dates'
import {
  archiveTeam,
  createTeamInvitation,
  fetchTeam,
  fetchTeamInvitations,
  fetchTeamMembers,
  fetchTeamSessions,
  hasTeamPermission,
  leaveTeam,
  removeTeamMember,
  resendTeamInvitation,
  revokeTeamInvitation,
  updateTeam,
  updateTeamMember,
  type TeamApiFailure,
  type TeamInvitation,
  type TeamMember,
  type TeamRole,
  type TeamSession,
  type TeamSummary,
} from '../lib/team-api'

export type TeamTab = 'sessions' | 'members' | 'settings'

type TeamState =
  | { kind: 'loading' }
  | { kind: 'ready'; team: TeamSummary }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'error' }

function redirectToSignIn(): void {
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`)
}

function failureMessage(result: TeamApiFailure, fallback: string): string {
  if (result.kind === 'forbidden') return result.detail ?? 'You do not have permission to do that.'
  if (result.kind === 'conflict')
    return result.detail ?? 'That change conflicts with current team state.'
  if (result.kind === 'invalid') return result.detail ?? 'Check the value and try again.'
  if (result.kind === 'rate-limited') return 'Too many changes. Wait a moment and try again.'
  if (result.kind === 'not-found') return 'This team resource no longer exists.'
  return fallback
}

export function TeamTabs({
  value,
  onChange,
}: {
  value: TeamTab
  onChange: (tab: TeamTab) => void
}) {
  return (
    <Tabs
      className="sw-team-tabs"
      aria-label="Team sections"
      value={value}
      items={[
        { value: 'sessions', label: 'Sessions', ariaControls: 'team-panel-sessions' },
        { value: 'members', label: 'Members', ariaControls: 'team-panel-members' },
        { value: 'settings', label: 'Settings', ariaControls: 'team-panel-settings' },
      ]}
      onValueChange={(next) => onChange(next as TeamTab)}
    />
  )
}

export function TeamPage({ teamId }: { teamId: string }) {
  const [state, setState] = useState<TeamState>({ kind: 'loading' })
  const [tab, setTab] = useState<TeamTab>('sessions')

  const loadTeam = useCallback(async () => {
    const result = await fetchTeam(teamId)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind === 'not-found') return setState({ kind: 'not-found' })
    if (result.kind === 'forbidden') return setState({ kind: 'forbidden' })
    if (result.kind !== 'ok') return setState({ kind: 'error' })
    setState({ kind: 'ready', team: result.data.team })
  }, [teamId])

  useEffect(() => {
    setState({ kind: 'loading' })
    void loadTeam()
  }, [loadTeam])

  const pageTitle = state.kind === 'ready' ? `${state.team.name} · spool.new` : 'Team · spool.new'
  useEffect(() => {
    document.title = pageTitle
  }, [pageTitle])

  if (state.kind === 'loading') {
    return <TeamStatus title="Loading team" busy />
  }
  if (state.kind === 'not-found' || state.kind === 'forbidden') {
    return (
      <TeamStatus
        title="Team unavailable"
        body="This team does not exist, or your account is not a current member."
      />
    )
  }
  if (state.kind === 'error') {
    return (
      <TeamStatus
        title="Could not load this team"
        body="The team service did not respond. Try again."
        action={<Button onClick={() => void loadTeam()}>Try again</Button>}
      />
    )
  }

  const { team } = state
  return (
    <Page>
      <Header contextTeam={{ id: team.id, name: team.name }} />
      <main className="sw-team-main">
        <div className="sw-team-shell">
          <header className="sw-team-heading">
            <div className="sw-team-heading-icon" aria-hidden="true">
              <Users size={20} strokeWidth={1.6} />
            </div>
            <div className="sw-team-heading-copy">
              <p className="sw-team-eyebrow">Team workspace</p>
              <h1>{team.name}</h1>
              <p>Team-owned Sessions live here; each row states who can read it.</p>
            </div>
            {team.role ? <Badge>{roleLabel(team.role)}</Badge> : null}
          </header>

          <TeamTabs value={tab} onChange={setTab} />
          <div className="sw-team-panel">
            {tab === 'sessions' ? <TeamSessionsPanel team={team} /> : null}
            {tab === 'members' ? (
              <TeamMembersPanel
                team={team}
                onTeamChanged={(next) => setState({ kind: 'ready', team: next })}
              />
            ) : null}
            {tab === 'settings' ? (
              <TeamSettingsPanel
                team={team}
                onTeamChanged={(next) => setState({ kind: 'ready', team: next })}
              />
            ) : null}
          </div>
        </div>
      </main>
      <Footer />
    </Page>
  )
}

function TeamStatus({
  title,
  body,
  busy,
  action,
}: {
  title: string
  body?: string
  busy?: boolean
  action?: ReactNode
}) {
  return (
    <Page>
      <Header />
      <main className="sw-main center" aria-busy={busy || undefined}>
        <div className="sw-card tight sw-team-status sw-card--480">
          {busy ? <span className="sw-spin sw-spin-anim" aria-hidden="true" /> : null}
          <h1 className="sw-title">{title}</h1>
          {body ? <p className="sw-lede muted">{body}</p> : null}
          {action ? <div className="sw-team-status-action">{action}</div> : null}
        </div>
      </main>
      <Footer />
    </Page>
  )
}

function roleLabel(role: TeamRole): string {
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  return 'Member'
}

export function pendingTeamInvitations(invitations: TeamInvitation[]): TeamInvitation[] {
  return invitations.filter(
    (invitation) => invitation.status === undefined || invitation.status === 'pending',
  )
}

export type TeamInvitationIntent = {
  currentKey(): string
  reset(): void
}

export function createTeamInvitationIntent(
  generateKey: () => string = () => crypto.randomUUID(),
): TeamInvitationIntent {
  let key: string | null = null
  return {
    currentKey() {
      if (key !== null) return key
      key = generateKey()
      return key
    },
    reset() {
      key = generateKey()
    },
  }
}

export function memberRoleConfirmation(
  teamName: string,
  member: TeamMember,
  role: TeamRole,
): string {
  const subject = member.display_name || member.email
  if (role === 'owner') {
    return `Transfer ownership of ${teamName} to ${subject}? They become the Owner and your role changes to Admin. They can then manage the workspace, membership, and every Team Session.`
  }
  if (member.role === 'owner') {
    return `Change ${subject} from Owner to ${roleLabel(role)}? They will lose ownership controls. The Team must keep at least one Owner.`
  }
  return `Change ${subject} from ${roleLabel(member.role)} to ${roleLabel(role)}? Their Team access changes immediately.`
}

export function memberRemovalConfirmation(teamName: string, member: TeamMember): string {
  return `Remove ${member.display_name || member.email} from ${teamName}? They immediately lose access to every Team Session. Team-owned Sessions remain with the Team.`
}

export function teamDuringOwnerMutation(
  team: TeamSummary,
  previousRole: TeamRole,
  nextRole: TeamRole | null,
): TeamSummary {
  if (nextRole === 'owner') return { ...team, role: null, permissions: [] }
  if (previousRole === 'owner') {
    return {
      ...team,
      permissions: team.permissions.filter((permission) => permission !== 'team:leave'),
    }
  }
  return team
}

export function TeamMemberActions({
  member,
  busy,
  removing = false,
  onRoleChange,
  onRemove,
}: {
  member: TeamMember
  busy: boolean
  removing?: boolean
  onRoleChange: (role: TeamRole) => void
  onRemove: () => void
}) {
  const canUpdateRole = member.permissions?.includes('role:update') ?? false
  const canTransferOwnership = member.permissions?.includes('ownership:transfer') ?? false
  const canRemove = member.permissions?.includes('remove') ?? false

  return (
    <div className="sw-team-member-actions">
      {canUpdateRole || canTransferOwnership ? (
        <select
          value={member.role}
          aria-label={`Role for ${member.display_name || member.email}`}
          disabled={busy}
          onChange={(event) => onRoleChange(event.target.value as TeamRole)}
        >
          {member.role === 'owner' ? <option value="owner">Owner</option> : null}
          {canUpdateRole || member.role === 'member' ? (
            <option value="member">Member</option>
          ) : null}
          {canUpdateRole || member.role === 'admin' ? <option value="admin">Admin</option> : null}
          {canTransferOwnership && member.role !== 'owner' ? (
            <option value="owner">Owner</option>
          ) : null}
        </select>
      ) : (
        <Badge>{roleLabel(member.role)}</Badge>
      )}
      {canRemove ? (
        <Button
          variant="danger"
          loading={removing}
          loadingLabel="Removing…"
          disabled={busy && !removing}
          onClick={onRemove}
        >
          <UserMinus aria-hidden="true" />
          Remove
        </Button>
      ) : null}
    </div>
  )
}

function TeamSessionsPanel({ team }: { team: TeamSummary }) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; sessions: TeamSession[] }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const result = await fetchTeamSessions(team.id)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok') {
      return setState({
        kind: 'error',
        message: failureMessage(result, 'Could not load Sessions.'),
      })
    }
    setState({ kind: 'ready', sessions: result.data.sessions })
  }, [team.id])

  useEffect(() => void load(), [load])

  function replaceSession(session: TeamSession) {
    setState((current) =>
      current.kind === 'ready'
        ? {
            kind: 'ready',
            sessions: current.sessions.map((item) => (item.sid === session.sid ? session : item)),
          }
        : current,
    )
  }

  function removeSession(sid: string) {
    setState((current) =>
      current.kind === 'ready'
        ? { kind: 'ready', sessions: withoutManagedSession(current.sessions, sid) }
        : current,
    )
  }

  return (
    <section id="team-panel-sessions" role="tabpanel" aria-label="Team Sessions">
      <SectionLabel count={state.kind === 'ready' ? state.sessions.length || undefined : undefined}>
        Team-owned Sessions
      </SectionLabel>
      {state.kind === 'loading' ? <PanelLoading label="Loading Sessions" /> : null}
      {state.kind === 'error' ? <PanelError message={state.message} onRetry={load} /> : null}
      {state.kind === 'ready' && state.sessions.length === 0 ? (
        <div className="sw-team-empty">
          <ShieldCheck size={20} strokeWidth={1.6} aria-hidden="true" />
          <div>
            <h2>No Team Sessions yet</h2>
            <p>Move a Session into this Team to give the workspace durable ownership.</p>
          </div>
        </div>
      ) : null}
      {state.kind === 'ready' && state.sessions.length > 0 ? (
        <ManagedSessionList
          sessions={state.sessions}
          teams={[team]}
          canManageVisibility={hasTeamPermission(team, 'sessions:manage')}
          onSessionChanged={replaceSession}
          onSessionWithdrawn={removeSession}
        />
      ) : null}
    </section>
  )
}

function TeamMembersPanel({
  team,
  onTeamChanged,
}: {
  team: TeamSummary
  onTeamChanged: (team: TeamSummary) => void
}) {
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [invitations, setInvitations] = useState<TeamInvitation[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<TeamRole, 'owner'>>('member')
  const [inviteIntent] = useState(() => createTeamInvitationIntent())
  const canInvite = hasTeamPermission(team, 'members:invite')

  const load = useCallback(async () => {
    setLoadError(null)
    const [memberResult, invitationResult] = await Promise.all([
      fetchTeamMembers(team.id),
      canInvite
        ? fetchTeamInvitations(team.id)
        : Promise.resolve({ kind: 'ok' as const, data: { invitations: [] } }),
    ])
    if (memberResult.kind === 'unauthenticated' || invitationResult.kind === 'unauthenticated') {
      return redirectToSignIn()
    }
    if (memberResult.kind !== 'ok') {
      return setLoadError(failureMessage(memberResult, 'Could not load team members.'))
    }
    setMembers(memberResult.data.members)
    if (invitationResult.kind === 'ok') {
      setInvitations(pendingTeamInvitations(invitationResult.data.invitations))
    } else if (canInvite) {
      setLoadError(failureMessage(invitationResult, 'Could not load pending invitations.'))
    } else {
      setInvitations([])
    }
  }, [canInvite, team.id])

  useEffect(() => void load(), [load])

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!normalized || busyKey !== null) return
    setBusyKey('invite')
    setActionError(null)
    const result = await createTeamInvitation(
      team.id,
      normalized,
      inviteRole,
      inviteIntent.currentKey(),
    )
    setBusyKey(null)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok') {
      return setActionError(failureMessage(result, 'Could not send the invitation.'))
    }
    inviteIntent.reset()
    setEmail('')
    setInvitations((current) => [result.data.invitation, ...(current ?? [])])
  }

  async function changeRole(member: TeamMember, role: TeamRole) {
    if (!window.confirm(memberRoleConfirmation(team.name, member, role))) return
    setBusyKey(`member:${member.user_id}:role`)
    setActionError(null)
    const result = await updateTeamMember(team.id, member.user_id, role)
    if (result.kind === 'unauthenticated') {
      setBusyKey(null)
      return redirectToSignIn()
    }
    if (result.kind !== 'ok') {
      setBusyKey(null)
      return setActionError(failureMessage(result, 'Could not update that member.'))
    }
    const ownershipChanged = role === 'owner' || member.role === 'owner'
    if (ownershipChanged) {
      // Do not leave the old sole/multi-owner capability set actionable while
      // the post-mutation Team projection refreshes. A transfer also changes
      // the actor's role, so clear all capabilities until the server replies.
      onTeamChanged(teamDuringOwnerMutation(team, member.role, role))
    }
    setMembers(
      (current) =>
        current?.map((item) => (item.user_id === member.user_id ? result.data.member : item)) ??
        null,
    )
    if (ownershipChanged) {
      const teamResult = await fetchTeam(team.id)
      if (role === 'owner') await load()
      setBusyKey(null)
      if (teamResult.kind === 'unauthenticated') return redirectToSignIn()
      if (teamResult.kind !== 'ok') {
        return setActionError(
          role === 'owner'
            ? 'Ownership transferred, but the Team permissions could not refresh.'
            : 'The role changed, but the Team permissions could not refresh.',
        )
      }
      onTeamChanged(teamResult.data.team)
      return
    }
    setBusyKey(null)
  }

  async function remove(member: TeamMember) {
    if (!window.confirm(memberRemovalConfirmation(team.name, member))) {
      return
    }
    setBusyKey(`member:${member.user_id}:remove`)
    setActionError(null)
    const result = await removeTeamMember(team.id, member.user_id)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok') {
      setBusyKey(null)
      return setActionError(failureMessage(result, 'Could not remove that member.'))
    }
    setMembers((current) => current?.filter((item) => item.user_id !== member.user_id) ?? null)
    if (member.role === 'owner') {
      onTeamChanged(teamDuringOwnerMutation(team, member.role, null))
      const teamResult = await fetchTeam(team.id)
      setBusyKey(null)
      if (teamResult.kind === 'unauthenticated') return redirectToSignIn()
      if (teamResult.kind !== 'ok') {
        return setActionError('The member was removed, but the Team permissions could not refresh.')
      }
      onTeamChanged(teamResult.data.team)
      return
    }
    setBusyKey(null)
  }

  async function actOnInvite(invitation: TeamInvitation, action: 'resend' | 'revoke') {
    if (
      action === 'revoke' &&
      !window.confirm(
        `Revoke the invitation for ${invitation.email}? Its current invite link will stop working.`,
      )
    ) {
      return
    }
    setBusyKey(`invite:${invitation.id}:${action}`)
    setActionError(null)
    const result =
      action === 'resend'
        ? await resendTeamInvitation(team.id, invitation.id)
        : await revokeTeamInvitation(team.id, invitation.id)
    setBusyKey(null)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok') {
      return setActionError(
        failureMessage(
          result,
          `Could not ${action === 'resend' ? 'resend' : 'revoke'} that invitation.`,
        ),
      )
    }
    if (action === 'revoke') {
      setInvitations((current) => current?.filter((item) => item.id !== invitation.id) ?? null)
    } else {
      setInvitations(
        (current) =>
          current?.map((item) => (item.id === invitation.id ? result.data.invitation : item)) ??
          null,
      )
    }
  }

  return (
    <section id="team-panel-members" role="tabpanel" aria-label="Team members">
      {canInvite ? (
        <form className="sw-team-invite" onSubmit={(event) => void invite(event)}>
          <div className="sw-team-section-copy">
            <h2>Invite a teammate</h2>
            <p>They will receive access after accepting the email invitation.</p>
          </div>
          <div className="sw-team-invite-controls">
            <label>
              <span className="sr-only">Email address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  inviteIntent.reset()
                }}
                placeholder="teammate@example.com"
                autoComplete="email"
                required
              />
            </label>
            <label>
              <span className="sr-only">Role</span>
              <select
                value={inviteRole}
                onChange={(event) => {
                  setInviteRole(event.target.value as 'admin' | 'member')
                  inviteIntent.reset()
                }}
                aria-label="Invitation role"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <Button
              variant="accent"
              size="lg"
              type="submit"
              loading={busyKey === 'invite'}
              loadingLabel="Sending…"
              disabled={busyKey !== 'invite' && (busyKey !== null || email.trim() === '')}
            >
              <MailPlus aria-hidden="true" />
              Send invite
            </Button>
          </div>
        </form>
      ) : null}

      {actionError ? (
        <p className="sw-team-action-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {loadError ? <PanelError message={loadError} onRetry={load} /> : null}
      {!loadError && members === null ? <PanelLoading label="Loading members" /> : null}

      {members !== null ? (
        <div className="sw-team-members-block">
          <SectionLabel count={members.length || undefined}>Members</SectionLabel>
          <ul className="sw-team-member-list">
            {members.map((member) => (
              <li key={member.user_id}>
                <Avatar
                  src={member.avatar_url ?? null}
                  name={member.display_name || member.email}
                  alt=""
                  size="md"
                />
                <div className="sw-team-member-identity">
                  <strong>{member.display_name || member.email}</strong>
                  <span>
                    {member.email}
                    {member.joined_at ? ` · joined ${humanDate(member.joined_at)}` : ''}
                  </span>
                </div>
                <TeamMemberActions
                  member={member}
                  busy={busyKey?.startsWith(`member:${member.user_id}:`) ?? false}
                  removing={busyKey === `member:${member.user_id}:remove`}
                  onRoleChange={(role) => void changeRole(member, role)}
                  onRemove={() => void remove(member)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canInvite && invitations !== null && invitations.length > 0 ? (
        <div className="sw-team-invitations-block">
          <SectionLabel count={invitations.length}>Pending invitations</SectionLabel>
          <ul className="sw-team-invitation-list">
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                <div className="sw-team-invitation-icon" aria-hidden="true">
                  <Clock3 size={14} strokeWidth={1.7} />
                </div>
                <div className="sw-team-member-identity">
                  <strong>{invitation.email}</strong>
                  <span>
                    {roleLabel(invitation.role)}
                    {invitation.expires_at ? ` · expires ${humanDate(invitation.expires_at)}` : ''}
                  </span>
                </div>
                <div className="sw-team-member-actions">
                  <Button
                    variant="ghost"
                    loading={busyKey === `invite:${invitation.id}:resend`}
                    loadingLabel="Resending…"
                    disabled={
                      (busyKey?.startsWith(`invite:${invitation.id}:`) ?? false) &&
                      busyKey !== `invite:${invitation.id}:resend`
                    }
                    onClick={() => void actOnInvite(invitation, 'resend')}
                  >
                    <RefreshCw aria-hidden="true" />
                    Resend
                  </Button>
                  <Button
                    variant="danger"
                    loading={busyKey === `invite:${invitation.id}:revoke`}
                    loadingLabel="Revoking…"
                    disabled={
                      (busyKey?.startsWith(`invite:${invitation.id}:`) ?? false) &&
                      busyKey !== `invite:${invitation.id}:revoke`
                    }
                    onClick={() => void actOnInvite(invitation, 'revoke')}
                  >
                    <Trash2 aria-hidden="true" />
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function TeamSettingsPanel({
  team,
  onTeamChanged,
}: {
  team: TeamSummary
  onTeamChanged: (team: TeamSummary) => void
}) {
  const [name, setName] = useState(team.name)
  const [busy, setBusy] = useState<'rename' | 'leave' | 'archive' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canUpdate = hasTeamPermission(team, 'team:update')
  const canArchive = hasTeamPermission(team, 'team:archive')
  const canLeave = hasTeamPermission(team, 'team:leave')

  useEffect(() => setName(team.name), [team.name])

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = name.trim()
    if (!next || next === team.name || busy !== null) return
    setBusy('rename')
    setError(null)
    const result = await updateTeam(team.id, next)
    setBusy(null)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok') {
      return setError(failureMessage(result, 'Could not rename this team.'))
    }
    onTeamChanged(result.data.team)
  }

  async function leave() {
    if (!window.confirm(`Leave ${team.name}? You will immediately lose access to Team Sessions.`)) {
      return
    }
    setBusy('leave')
    setError(null)
    const result = await leaveTeam(team.id)
    setBusy(null)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok') return setError(failureMessage(result, 'Could not leave this team.'))
    window.location.assign('/me#teams')
  }

  async function archive() {
    if (
      !window.confirm(
        `Archive ${team.name}? Team Sessions will no longer be available to members. This cannot be undone here.`,
      )
    ) {
      return
    }
    setBusy('archive')
    setError(null)
    const result = await archiveTeam(team.id)
    setBusy(null)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok')
      return setError(failureMessage(result, 'Could not archive this team.'))
    window.location.assign('/me#teams')
  }

  return (
    <section id="team-panel-settings" role="tabpanel" aria-label="Team settings">
      <div className="sw-team-settings-section">
        <div className="sw-team-section-copy">
          <h2>Team details</h2>
          <p>The team name appears anywhere membership and Team-only visibility are shown.</p>
        </div>
        {canUpdate ? (
          <form className="sw-team-rename" onSubmit={(event) => void rename(event)}>
            <label>
              <span>Team name</span>
              <input
                value={name}
                maxLength={80}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button
              variant="outline"
              size="lg"
              type="submit"
              loading={busy === 'rename'}
              loadingLabel="Saving…"
              disabled={
                busy !== 'rename' &&
                (busy !== null || name.trim() === '' || name.trim() === team.name)
              }
            >
              <Settings2 aria-hidden="true" />
              Save name
            </Button>
          </form>
        ) : (
          <div className="sw-team-readonly-name">{team.name}</div>
        )}
      </div>

      {canLeave || canArchive ? (
        <div className="sw-team-settings-section sw-team-danger-zone">
          <div className="sw-team-section-copy">
            <h2>Workspace access</h2>
            <p>Membership changes apply immediately to every Team Session.</p>
          </div>
          <div className="sw-team-danger-actions">
            {canLeave ? (
              <Button
                variant="danger"
                loading={busy === 'leave'}
                loadingLabel="Leaving…"
                disabled={busy !== null && busy !== 'leave'}
                onClick={() => void leave()}
              >
                <UserMinus aria-hidden="true" />
                Leave team
              </Button>
            ) : null}
            {canArchive ? (
              <Button
                variant="danger"
                loading={busy === 'archive'}
                loadingLabel="Archiving…"
                disabled={busy !== null && busy !== 'archive'}
                onClick={() => void archive()}
              >
                <Archive aria-hidden="true" />
                Archive team
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="sw-team-action-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="sw-team-panel-message" aria-busy="true">
      <span className="sw-spin sw-spin-anim" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

function PanelError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void | Promise<void>
}) {
  return (
    <div className="sw-team-panel-error" role="alert">
      <p>{message}</p>
      <Button variant="outline" onClick={() => void onRetry()}>
        Try again
      </Button>
    </div>
  )
}
