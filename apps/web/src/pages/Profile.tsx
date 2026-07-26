import { Avatar, Button, SectionLabel } from '@spool-lab/ui'
import { Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Footer, Header, Page } from '../components/Chrome'
import { ProjectCard } from '../components/ProjectCard'
import { SessionFeedRow, SessionSourceBadge } from '../components/SessionFeedRow'
import { SessionLanguageToolbar } from '../components/SessionLanguageToggle'
import { appendUniqueManagedSessions } from '../lib/hub-management-api'
import { sessionLanguageTag, useSessionLanguage } from '../lib/language'
import { normalizeTabTitle } from '../lib/page-title'
import { fetchOwnerProjects, type ProjectOwnerPage } from '../lib/project-api'
import {
  formatSessionCost,
  resolveLocalizedSessionSummary,
  resolveLocalizedTitle,
} from '../lib/session-title'

import '../styles/projects.css'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: ProjectOwnerPage }
  | { kind: 'not-found' }
  | { kind: 'error' }

export function Profile({ handle }: { handle: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const requestIdRef = useRef(0)
  const language = useSessionLanguage()

  useEffect(() => {
    const requestId = ++requestIdRef.current
    let cancelled = false
    setState({ kind: 'loading' })
    setLoadingMore(false)
    setLoadMoreError(false)
    void fetchOwnerProjects(handle).then((result) => {
      if (cancelled || requestId !== requestIdRef.current) return
      if (result.kind === 'ok') {
        setState({ kind: 'ready', data: result.data })
        document.title = `${normalizeTabTitle(result.data.owner.name || `@${handle}`)} · spool.new`
      } else if (
        result.kind === 'not-found' ||
        result.kind === 'forbidden' ||
        result.kind === 'unauthenticated'
      ) {
        setState({ kind: 'not-found' })
        document.title = 'Profile not found · spool.new'
      } else {
        setState({ kind: 'error' })
        document.title = 'Profile unavailable · spool.new'
      }
    })
    return () => {
      cancelled = true
    }
  }, [handle])

  async function loadMoreSessions() {
    if (
      state.kind !== 'ready' ||
      state.data.owner.kind === 'team' ||
      state.data.next_cursor === null ||
      loadingMore
    ) {
      return
    }
    const requestId = ++requestIdRef.current
    const cursor = state.data.next_cursor
    setLoadingMore(true)
    setLoadMoreError(false)
    const result = await fetchOwnerProjects(handle, cursor)
    if (requestId !== requestIdRef.current) return
    setLoadingMore(false)
    if (result.kind !== 'ok') {
      setLoadMoreError(true)
      return
    }
    setState((current) =>
      current.kind !== 'ready'
        ? current
        : {
            kind: 'ready',
            data: {
              ...result.data,
              sessions: appendUniqueManagedSessions(
                current.data.sessions ?? [],
                result.data.sessions ?? [],
              ),
            },
          },
    )
  }

  if (state.kind === 'loading') {
    return (
      <Page>
        <Header />
        <main className="project-public-main">
          <div className="project-public-skeleton" aria-busy="true">
            <span className="sw-skel" />
            <span className="sw-skel" />
            <span className="sw-skel" />
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  if (state.kind === 'not-found' || state.kind === 'error') {
    return (
      <Page>
        <Header />
        <main className="project-public-main">
          <div className="projects-state">
            <h1>{state.kind === 'error' ? 'Could not load profile' : 'Nothing here'}</h1>
            <p>
              {state.kind === 'error'
                ? 'The profile service did not respond. Try again.'
                : 'Check the handle, or ask the owner for a fresh Project link.'}
            </p>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  const { owner, projects } = state.data
  // Keep the public profile resilient during a rolling API deployment while
  // preserving the hard Team boundary: Team Sessions belong only in the
  // authenticated workspace, never on /@handle.
  const sessions = state.data.sessions ?? []
  const sessionCount = state.data.session_count ?? sessions.length
  const teamOwned = owner.kind === 'team'
  const hasBilingualSessions =
    !teamOwned &&
    sessions.some(
      (session) =>
        Boolean(session.titles?.en && session.titles.zh) ||
        Boolean(session.summaries?.en && session.summaries.zh),
    )
  return (
    <Page>
      <Header
        contextTeam={owner.kind === 'team' ? { id: owner.id, name: owner.name } : null}
        sticky
      />
      {hasBilingualSessions ? <SessionLanguageToolbar /> : null}
      <main className="project-public-main">
        <header className="profile-project-header">
          <Avatar src={owner.avatar_url ?? null} name={owner.name} alt="" size="lg" />
          <div>
            <h1>{owner.name}</h1>
            <p>@{owner.handle}</p>
            <span>
              {projects.length} {projects.length === 1 ? 'Project' : 'Projects'}
              {!teamOwned ? (
                <>
                  {' '}
                  · {sessionCount} Public {sessionCount === 1 ? 'Session' : 'Sessions'}
                </>
              ) : null}
            </span>
          </div>
        </header>
        <section className="profile-projects" aria-labelledby="profile-projects-heading">
          <SectionLabel
            id="profile-projects-heading"
            role="heading"
            aria-level={2}
            count={projects.length || undefined}
          >
            Projects
          </SectionLabel>
          {projects.length === 0 ? (
            <div className="projects-state profile-projects-empty">
              <h2>No public Projects yet</h2>
              <p>Projects appear after they contain a Public Session.</p>
            </div>
          ) : (
            <div className="projects-list">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </section>
        {!teamOwned ? (
          <section className="profile-sessions" aria-labelledby="profile-sessions-heading">
            <SectionLabel
              id="profile-sessions-heading"
              role="heading"
              aria-level={2}
              count={sessionCount || undefined}
            >
              Public Sessions
            </SectionLabel>
            {sessions.length === 0 ? (
              <div className="projects-state profile-projects-empty">
                <h2>No Public Sessions yet</h2>
                <p>Sessions appear here after they are associated with a Project.</p>
              </div>
            ) : (
              <div className="project-session-list">
                {sessions.map((session) => {
                  const title = resolveLocalizedTitle(session.titles, session.title, language)
                  const summary = resolveLocalizedSessionSummary(
                    session.summaries,
                    session.summary,
                    language,
                  )
                  const cost = formatSessionCost(session.cost)
                  const stars = session.star_count ?? 0
                  return (
                    <SessionFeedRow
                      key={session.sid}
                      sid={session.sid}
                      title={title.text ?? session.title}
                      summary={summary.text}
                      titleLanguage={
                        title.language ? sessionLanguageTag(title.language) : undefined
                      }
                      summaryLanguage={
                        summary.language ? sessionLanguageTag(summary.language) : undefined
                      }
                      author={{
                        handle: session.author.handle,
                        displayName: session.author.display_name,
                        avatarUrl: session.author.avatar_url,
                      }}
                      timestamp={session.published_at ?? session.created_at}
                      timestampVerb="published"
                      metadata={
                        <div className="session-feed-row-meta">
                          <SessionSourceBadge provider={session.provider} />
                          {cost ? <span className="session-feed-cost">{cost}</span> : null}
                          <span title={`${stars} ${stars === 1 ? 'star' : 'stars'}`}>
                            <Star size={13} strokeWidth={1.7} aria-hidden="true" />
                            {stars} {stars === 1 ? 'star' : 'stars'}
                          </span>
                        </div>
                      }
                    />
                  )
                })}
              </div>
            )}
            {state.data.next_cursor !== null || loadMoreError ? (
              <div className="project-session-load-more">
                <Button
                  variant="outline"
                  loading={loadingMore}
                  loadingLabel="Loading more Sessions…"
                  onClick={() => void loadMoreSessions()}
                >
                  {loadMoreError ? 'Try loading more again' : 'Load more Sessions'}
                </Button>
                {loadMoreError ? (
                  <p role="alert">
                    More Sessions could not be loaded. Your current list is intact.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
      <Footer />
    </Page>
  )
}
