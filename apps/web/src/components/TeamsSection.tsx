import { Badge, Button, SectionLabel } from '@spool-lab/ui'
import { ArrowRight, Plus, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { createTeam, fetchTeams, type TeamApiFailure, type TeamSummary } from '../lib/team-api'

type TeamsState =
  | { kind: 'loading' }
  | { kind: 'ready'; teams: TeamSummary[] }
  | { kind: 'error'; message: string }

export function teamHandleFromName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/[-_]+$/g, '')
    .slice(0, 32)
}

function teamFailureMessage(result: TeamApiFailure): string {
  if (result.kind === 'conflict') return result.detail ?? 'A team with that name already exists.'
  if (result.kind === 'invalid') return result.detail ?? 'Enter a valid team name.'
  if (result.kind === 'rate-limited') return 'Too many attempts. Wait a moment and try again.'
  if (result.kind === 'forbidden') return result.detail ?? 'You cannot create a team right now.'
  return 'The Team service is unavailable. Try again.'
}

function redirectToSignIn(next: string): void {
  window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`)
}

export type TeamCreateIntent = {
  currentKey(): string
  nameEdited(): void
  started(): void
  succeeded(): void
}

export function createTeamCreateIntent(
  generateKey: () => string = () => crypto.randomUUID(),
): TeamCreateIntent {
  let key: string | null = null
  const rotate = () => {
    key = generateKey()
  }
  return {
    currentKey() {
      if (key !== null) return key
      const next = generateKey()
      key = next
      return next
    },
    nameEdited: rotate,
    started: rotate,
    succeeded: rotate,
  }
}

export function TeamList({ teams }: { teams: TeamSummary[] }) {
  if (teams.length === 0) {
    return (
      <div className="sw-teams-empty">
        <Users size={20} strokeWidth={1.6} aria-hidden="true" />
        <div>
          <strong>No teams yet</strong>
          <p>Create a workspace to share Sessions only with current members.</p>
        </div>
      </div>
    )
  }

  return (
    <ul className="sw-teams-list">
      {teams.map((team) => (
        <li key={team.id}>
          <a href={`/teams/${encodeURIComponent(team.id)}`}>
            <div className="sw-teams-list-icon" aria-hidden="true">
              <Users size={16} strokeWidth={1.7} />
            </div>
            <div className="sw-teams-list-copy">
              <strong>{team.name}</strong>
              <span>
                {team.member_count === undefined
                  ? 'Team workspace'
                  : `${team.member_count} ${team.member_count === 1 ? 'member' : 'members'}`}
              </span>
            </div>
            {team.role ? (
              <Badge className="sw-teams-list-role">
                {team.role === 'owner' ? 'Owner' : team.role === 'admin' ? 'Admin' : 'Member'}
              </Badge>
            ) : null}
            <ArrowRight
              className="sw-teams-list-arrow"
              size={14}
              strokeWidth={1.7}
              aria-hidden="true"
            />
          </a>
        </li>
      ))}
    </ul>
  )
}

export function TeamsSection({
  signInNext = '/me',
  presentation = 'index',
}: {
  signInNext?: string
  presentation?: 'index' | 'create'
} = {}) {
  const creationOnly = presentation === 'create'
  const [state, setState] = useState<TeamsState>({ kind: 'loading' })
  const [creating, setCreating] = useState(creationOnly)
  const [createBusy, setCreateBusy] = useState(false)
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [handleEdited, setHandleEdited] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const submitting = useRef(false)
  const [createIntent] = useState(() => createTeamCreateIntent())

  const load = useCallback(async () => {
    const result = await fetchTeams()
    if (result.kind === 'unauthenticated') return redirectToSignIn(signInNext)
    if (result.kind !== 'ok') {
      return setState({ kind: 'error', message: teamFailureMessage(result) })
    }
    setState({ kind: 'ready', teams: result.data.teams })
  }, [signInNext])

  useEffect(() => void load(), [load])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || submitting.current) return
    submitting.current = true
    setCreateBusy(true)
    setCreateError(null)
    const normalizedHandle = teamHandleFromName(handle || trimmed)
    if (!normalizedHandle) {
      submitting.current = false
      setCreateBusy(false)
      setCreateError('Choose a handle that starts with a letter.')
      return
    }
    const result = await createTeam(trimmed, createIntent.currentKey(), normalizedHandle)
    submitting.current = false
    setCreateBusy(false)
    if (result.kind === 'unauthenticated') return redirectToSignIn(signInNext)
    if (result.kind !== 'ok') return setCreateError(teamFailureMessage(result))
    createIntent.succeeded()
    window.location.assign(`/teams/${encodeURIComponent(result.data.team.id)}`)
  }

  return (
    <section id="teams" className="sw-teams-section" aria-labelledby="teams-heading">
      <SectionLabel
        id="teams-heading"
        role="heading"
        aria-level={2}
        count={
          !creationOnly && state.kind === 'ready' && state.teams.length > 0
            ? state.teams.length
            : undefined
        }
        action={
          creationOnly ? undefined : (
            <Button
              size="sm"
              variant="ghost"
              className="sw-teams-create-trigger"
              aria-expanded={creating}
              onClick={() => {
                setCreateError(null)
                setCreating((value) => {
                  if (!value) createIntent.started()
                  return !value
                })
              }}
            >
              <Plus aria-hidden="true" />
              Create team
            </Button>
          )
        }
      >
        {creationOnly ? 'New team' : 'Teams'}
      </SectionLabel>

      {creating ? (
        <form className="sw-team-create-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Team name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => {
                const next = event.target.value
                setName(next)
                if (!handleEdited) setHandle(teamHandleFromName(next))
                createIntent.nameEdited()
              }}
              maxLength={80}
              placeholder="Paperboy"
              required
            />
          </label>
          <label>
            <span>Team handle</span>
            <span className="sw-team-handle-input">
              <span>@</span>
              <input
                value={handle}
                onChange={(event) => {
                  setHandleEdited(true)
                  setHandle(event.target.value.toLowerCase())
                  createIntent.nameEdited()
                }}
                minLength={3}
                maxLength={32}
                pattern="[a-z][a-z0-9_-]{2,31}"
                placeholder="paperboy"
                autoComplete="off"
                required
              />
            </span>
          </label>
          <div className="sw-team-create-actions">
            {!creationOnly ? (
              <Button
                type="button"
                variant="ghost"
                disabled={createBusy}
                onClick={() => {
                  setCreating(false)
                  setName('')
                  setHandle('')
                  setHandleEdited(false)
                  setCreateError(null)
                }}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              size="lg"
              type="submit"
              variant="accent"
              loading={createBusy}
              loadingLabel="Creating…"
              disabled={!createBusy && (name.trim() === '' || teamHandleFromName(handle) === '')}
            >
              Create team
            </Button>
          </div>
          {createError ? (
            <p className="sw-team-action-error" role="alert">
              {createError}
            </p>
          ) : null}
        </form>
      ) : null}

      {!creationOnly && state.kind === 'loading' ? (
        <div className="sw-team-panel-message" aria-busy="true">
          <span className="sw-spin sw-spin-anim" aria-hidden="true" />
          <span>Loading teams</span>
        </div>
      ) : null}
      {!creationOnly && state.kind === 'error' ? (
        <div className="sw-team-panel-error" role="alert">
          <p>{state.message}</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}
      {!creationOnly && state.kind === 'ready' ? <TeamList teams={state.teams} /> : null}
    </section>
  )
}
