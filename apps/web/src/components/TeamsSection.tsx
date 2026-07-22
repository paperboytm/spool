import { Badge, Button, SectionLabel } from '@spool-lab/ui'
import { ArrowRight, Plus, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { createTeam, fetchTeams, type TeamApiFailure, type TeamSummary } from '../lib/team-api'

type TeamsState =
  | { kind: 'loading' }
  | { kind: 'ready'; teams: TeamSummary[] }
  | { kind: 'error'; message: string }

function teamFailureMessage(result: TeamApiFailure): string {
  if (result.kind === 'conflict') return result.detail ?? 'A team with that name already exists.'
  if (result.kind === 'invalid') return result.detail ?? 'Enter a valid team name.'
  if (result.kind === 'rate-limited') return 'Too many attempts. Wait a moment and try again.'
  if (result.kind === 'forbidden') return result.detail ?? 'You cannot create a team right now.'
  return 'The Team service is unavailable. Try again.'
}

function redirectToSignIn(): void {
  window.location.assign('/sign-in?next=/me')
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
              <Badge>
                {team.role === 'owner' ? 'Owner' : team.role === 'admin' ? 'Admin' : 'Member'}
              </Badge>
            ) : null}
            <ArrowRight size={14} strokeWidth={1.7} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  )
}

export function TeamsSection() {
  const [state, setState] = useState<TeamsState>({ kind: 'loading' })
  const [creating, setCreating] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const submitting = useRef(false)
  const [createIntent] = useState(() => createTeamCreateIntent())

  const load = useCallback(async () => {
    const result = await fetchTeams()
    if (result.kind === 'unauthenticated') return redirectToSignIn()
    if (result.kind !== 'ok') {
      return setState({ kind: 'error', message: teamFailureMessage(result) })
    }
    setState({ kind: 'ready', teams: result.data.teams })
  }, [])

  useEffect(() => void load(), [load])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || submitting.current) return
    submitting.current = true
    setCreateBusy(true)
    setCreateError(null)
    const result = await createTeam(trimmed, createIntent.currentKey())
    submitting.current = false
    setCreateBusy(false)
    if (result.kind === 'unauthenticated') return redirectToSignIn()
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
        count={state.kind === 'ready' && state.teams.length > 0 ? state.teams.length : undefined}
        action={
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
        }
      >
        Teams
      </SectionLabel>

      {creating ? (
        <form className="sw-team-create-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Team name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                createIntent.nameEdited()
              }}
              maxLength={80}
              placeholder="Paperboy"
              required
            />
          </label>
          <div className="sw-team-create-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={createBusy}
              onClick={() => {
                setCreating(false)
                setName('')
                setCreateError(null)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="accent" disabled={createBusy || name.trim() === ''}>
              {createBusy ? 'Creating…' : 'Create team'}
            </Button>
          </div>
          {createError ? (
            <p className="sw-team-action-error" role="alert">
              {createError}
            </p>
          ) : null}
        </form>
      ) : null}

      {state.kind === 'loading' ? (
        <div className="sw-team-panel-message" aria-busy="true">
          <span className="sw-spin sw-spin-anim" aria-hidden="true" />
          <span>Loading teams</span>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="sw-team-panel-error" role="alert">
          <p>{state.message}</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}
      {state.kind === 'ready' ? <TeamList teams={state.teams} /> : null}
    </section>
  )
}
