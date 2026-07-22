import { Button, SectionLabel } from '@spool-lab/ui'
import { ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { fetchMySessions, type ManagedSession } from '../lib/hub-management-api'
import { fetchTeams, type TeamSummary } from '../lib/team-api'
import { ManagedSessionList, withoutManagedSession } from './ManagedSessionList'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; sessions: ManagedSession[]; teams: TeamSummary[] }
  | { kind: 'error' }

function redirectToSignIn(): void {
  window.location.assign('/sign-in?next=/me')
}

export function ManagedSessionsSection() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const [sessionResult, teamResult] = await Promise.all([fetchMySessions(), fetchTeams()])
    if (sessionResult.kind === 'unauthenticated' || teamResult.kind === 'unauthenticated') {
      return redirectToSignIn()
    }
    if (sessionResult.kind !== 'ok' || teamResult.kind !== 'ok') {
      return setState({ kind: 'error' })
    }
    setState({
      kind: 'ready',
      sessions: sessionResult.data.sessions,
      teams: teamResult.data.teams,
    })
  }, [])

  useEffect(() => void load(), [load])

  function replaceSession(session: ManagedSession) {
    setState((current) =>
      current.kind === 'ready'
        ? {
            ...current,
            sessions: current.sessions.map((item) => (item.sid === session.sid ? session : item)),
          }
        : current,
    )
  }

  function removeSession(sid: string) {
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, sessions: withoutManagedSession(current.sessions, sid) }
        : current,
    )
  }

  return (
    <section className="sw-managed-sessions" aria-labelledby="sessions-heading">
      <SectionLabel
        id="sessions-heading"
        role="heading"
        aria-level={2}
        count={
          state.kind === 'ready' && state.sessions.length > 0 ? state.sessions.length : undefined
        }
      >
        Sessions
      </SectionLabel>
      <p className="sw-section-help">
        Manage who can read each uploaded Session. Team moves transfer durable ownership.
      </p>

      {state.kind === 'loading' ? (
        <div className="sw-team-panel-message" aria-busy="true">
          <span className="sw-spin sw-spin-anim" aria-hidden="true" />
          <span>Loading Sessions</span>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="sw-team-panel-error" role="alert">
          <p>Could not load your Sessions and Team options.</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}
      {state.kind === 'ready' && state.sessions.length === 0 ? (
        <div className="sw-team-empty">
          <ShieldCheck size={20} strokeWidth={1.6} aria-hidden="true" />
          <div>
            <h2>No uploaded Sessions yet</h2>
            <p>Sessions shared from the desktop app or CLI will appear here.</p>
          </div>
        </div>
      ) : null}
      {state.kind === 'ready' && state.sessions.length > 0 ? (
        <ManagedSessionList
          sessions={state.sessions}
          teams={state.teams}
          canManageVisibility
          onSessionChanged={replaceSession}
          onSessionWithdrawn={removeSession}
        />
      ) : null}
    </section>
  )
}
