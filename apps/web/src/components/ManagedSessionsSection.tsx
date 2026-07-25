import { Button, SectionLabel } from '@spool-lab/ui'
import { Library } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  appendUniqueManagedSessions,
  fetchMySessions,
  type ManagedSession,
} from '../lib/hub-management-api'
import { fetchTeams, type TeamSummary } from '../lib/team-api'
import { ManagedSessionList, withoutManagedSession } from './ManagedSessionList'
import { SessionFeedSkeleton } from './SessionFeedRow'

type State =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      sessions: ManagedSession[]
      teams: TeamSummary[]
      nextCursor: string | null
      loadingMore: boolean
      moreError: string | null
    }
  | { kind: 'error' }

function redirectToSignIn(next: string): void {
  window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`)
}

export function ManagedSessionsSection({
  signInNext = '/me',
  presentation = 'management',
}: {
  signInNext?: string
  presentation?: 'management' | 'feed'
} = {}) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const isFeed = presentation === 'feed'

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const [sessionResult, teamResult] = await Promise.all([fetchMySessions(), fetchTeams()])
    if (sessionResult.kind === 'unauthenticated' || teamResult.kind === 'unauthenticated') {
      return redirectToSignIn(signInNext)
    }
    if (sessionResult.kind !== 'ok' || teamResult.kind !== 'ok') {
      return setState({ kind: 'error' })
    }
    setState({
      kind: 'ready',
      sessions: sessionResult.data.sessions,
      teams: teamResult.data.teams,
      nextCursor: sessionResult.data.next_cursor ?? null,
      loadingMore: false,
      moreError: null,
    })
  }, [signInNext])

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

  async function loadMore() {
    if (state.kind !== 'ready' || state.nextCursor === null || state.loadingMore) return
    const cursor = state.nextCursor
    setState({ ...state, loadingMore: true, moreError: null })

    const result = await fetchMySessions(cursor)
    if (result.kind === 'unauthenticated') return redirectToSignIn(signInNext)
    if (result.kind !== 'ok') {
      return setState((current) =>
        current.kind === 'ready' && current.nextCursor === cursor
          ? {
              ...current,
              loadingMore: false,
              moreError: 'Could not load more Sessions. Your current list is unchanged.',
            }
          : current,
      )
    }
    setState((current) =>
      current.kind === 'ready' && current.nextCursor === cursor
        ? {
            ...current,
            sessions: appendUniqueManagedSessions(current.sessions, result.data.sessions),
            nextCursor: result.data.next_cursor ?? null,
            loadingMore: false,
            moreError: null,
          }
        : current,
    )
  }

  return (
    <section
      className={isFeed ? 'session-feed sessions-managed-feed' : 'sw-managed-sessions'}
      aria-labelledby={isFeed ? undefined : 'sessions-heading'}
      aria-label={isFeed ? 'Your Sessions' : undefined}
    >
      {!isFeed ? (
        <>
          <SectionLabel
            id="sessions-heading"
            role="heading"
            aria-level={2}
            count={
              state.kind === 'ready' && state.sessions.length > 0
                ? state.sessions.length
                : undefined
            }
          >
            Sessions
          </SectionLabel>
          <p className="sw-section-help">
            Manage who can read each uploaded Session. Team moves transfer durable ownership.
          </p>
        </>
      ) : null}

      {state.kind === 'loading' ? (
        isFeed ? (
          <SessionFeedSkeleton rows={3} />
        ) : (
          <div className="sw-team-panel-message" aria-busy="true">
            <span className="sw-spin sw-spin-anim" aria-hidden="true" />
            <span>Loading Sessions</span>
          </div>
        )
      ) : null}
      {state.kind === 'error' ? (
        <div className={isFeed ? 'session-feed-error' : 'sw-team-panel-error'} role="alert">
          <p>Could not load your Sessions and Team options.</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : null}
      {state.kind === 'ready' && state.sessions.length === 0 ? (
        <div className={isFeed ? 'session-feed-state' : 'sw-team-empty'}>
          <Library size={20} strokeWidth={1.6} aria-hidden="true" />
          <div>
            <h2>No uploaded Sessions yet</h2>
            <p>Share a Session from the CLI to see it here.</p>
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
      {state.kind === 'ready' && state.nextCursor !== null ? (
        <div className={isFeed ? undefined : 'sw-team-status sw-team-status-action'}>
          <Button
            className={isFeed ? 'session-feed-load-more' : undefined}
            variant="outline"
            loading={state.loadingMore}
            loadingLabel="Loading Sessions…"
            onClick={() => void loadMore()}
          >
            Load more Sessions
          </Button>
          {state.moreError ? (
            <p className="managed-session-error" role="alert">
              {state.moreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
