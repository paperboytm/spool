import { Badge, Button, ButtonLink, SectionLabel } from '@spool-lab/ui'
import { ExternalLink, FolderKanban, LockKeyhole, Star } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Footer, Header, Page } from '../components/Chrome'
import { SessionFeedRow, SessionSourceBadge } from '../components/SessionFeedRow'
import { SessionLanguageToolbar } from '../components/SessionLanguageToggle'
import { appendUniqueManagedSessions } from '../lib/hub-management-api'
import { sessionLanguageTag, useSessionLanguage } from '../lib/language'
import {
  fetchOwnerProject,
  type ProjectApiFailure,
  type ProjectPage as ProjectPagePayload,
} from '../lib/project-api'
import {
  formatSessionCost,
  resolveLocalizedSessionSummary,
  resolveLocalizedTitle,
} from '../lib/session-title'

import '../styles/projects.css'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: ProjectPagePayload }
  | { kind: 'unavailable' }
  | { kind: 'error' }

function unavailable(result: ProjectApiFailure): State {
  if (result.kind === 'not-found' || result.kind === 'forbidden') return { kind: 'unavailable' }
  if (result.kind === 'unauthenticated') return { kind: 'unavailable' }
  return { kind: 'error' }
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

export function projectEmptyStateCopy(teamOwned: boolean): {
  heading: string
  detail: string
} {
  return teamOwned
    ? {
        heading: 'No Team Sessions yet',
        detail: 'Sessions appear here after their author associates them from the Spool CLI.',
      }
    : {
        heading: 'No Public Sessions in this Project yet',
        detail: 'Sessions appear here after their author associates them from the Spool CLI.',
      }
}

export function ProjectPage({ handle, slug }: { handle: string; slug: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const requestIdRef = useRef(0)
  const language = useSessionLanguage()

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setState({ kind: 'loading' })
    setLoadingMore(false)
    setLoadMoreError(false)
    const result = await fetchOwnerProject(handle, slug)
    if (requestId !== requestIdRef.current) return
    if (result.kind === 'ok') {
      setState({ kind: 'ready', data: result.data })
      document.title = `${result.data.project.name} · @${result.data.project.owner.handle} · spool.new`
      return
    }
    setState(unavailable(result))
    document.title = 'Project unavailable · spool.new'
  }, [handle, slug])

  useEffect(() => {
    void load()
  }, [load])

  async function loadMoreSessions() {
    if (state.kind !== 'ready' || state.data.next_cursor === null || loadingMore) return
    const requestId = ++requestIdRef.current
    const cursor = state.data.next_cursor
    setLoadingMore(true)
    setLoadMoreError(false)
    const result = await fetchOwnerProject(handle, slug, cursor)
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
              sessions: appendUniqueManagedSessions(current.data.sessions, result.data.sessions),
            },
          },
    )
  }

  if (state.kind === 'loading') {
    return (
      <Page>
        <Header sticky />
        <main className="project-public-main" aria-busy="true">
          <div className="project-public-skeleton">
            <span className="sw-skel" />
            <span className="sw-skel" />
            <span className="sw-skel" />
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  if (state.kind === 'unavailable' || state.kind === 'error') {
    return (
      <Page>
        <Header sticky />
        <main className="project-public-main">
          <div className="projects-state">
            <FolderKanban size={22} strokeWidth={1.6} aria-hidden="true" />
            <h1>{state.kind === 'error' ? 'Could not load Project' : 'Project unavailable'}</h1>
            <p>
              {state.kind === 'error'
                ? 'The Project service did not respond. Try again.'
                : 'This Project does not exist, or it belongs to a Team you cannot access.'}
            </p>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  const { project, sessions } = state.data
  const teamOwned = project.owner.kind === 'team'
  const hasBilingualSessions = sessions.some(
    (session) =>
      Boolean(session.titles?.en && session.titles.zh) ||
      Boolean(session.summaries?.en && session.summaries.zh),
  )
  const editHref = teamOwned
    ? `/projects/${encodeURIComponent(project.id)}/edit?team=${encodeURIComponent(project.owner.id)}`
    : `/projects/${encodeURIComponent(project.id)}/edit`
  const emptyState = projectEmptyStateCopy(teamOwned)

  return (
    <Page>
      <Header
        contextTeam={teamOwned ? { id: project.owner.id, name: project.owner.name } : null}
        sticky
      />
      {hasBilingualSessions ? <SessionLanguageToolbar /> : null}
      <main className="project-public-main">
        <header className="project-public-header">
          <div className="project-public-kicker">
            <a href={`/@${encodeURIComponent(project.owner.handle)}`}>@{project.owner.handle}</a>
            <span aria-hidden="true">/</span>
            <span>{project.slug}</span>
          </div>
          <div className="project-public-title-row">
            <div>
              <h1>{project.name}</h1>
              <p>{project.description || 'A home for related agent Sessions.'}</p>
            </div>
            <div className="project-public-actions">
              {teamOwned ? (
                <Badge>
                  <LockKeyhole size={12} aria-hidden="true" />
                  Team · {project.owner.name}
                </Badge>
              ) : null}
              {project.github_url ? (
                <ButtonLink
                  href={project.github_url}
                  target="_blank"
                  rel="noreferrer"
                  variant="outline"
                >
                  GitHub
                  <ExternalLink size={14} aria-hidden="true" />
                </ButtonLink>
              ) : null}
              {project.can_manage ? (
                <ButtonLink href={editHref} variant="ghost">
                  Edit
                </ButtonLink>
              ) : null}
            </div>
          </div>
        </header>

        <section className="project-public-sessions" aria-labelledby="project-sessions-heading">
          <SectionLabel
            id="project-sessions-heading"
            role="heading"
            aria-level={2}
            count={project.session_count || undefined}
          >
            Sessions
          </SectionLabel>
          {sessions.length === 0 ? (
            <div className="projects-state project-public-empty">
              <FolderKanban size={20} strokeWidth={1.6} aria-hidden="true" />
              <h2>{emptyState.heading}</h2>
              <p>{emptyState.detail}</p>
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
                    titleLanguage={title.language ? sessionLanguageTag(title.language) : undefined}
                    summaryLanguage={
                      summary.language ? sessionLanguageTag(summary.language) : undefined
                    }
                    author={{
                      handle: session.author.handle,
                      displayName: session.author.display_name,
                      avatarUrl: session.author.avatar_url,
                    }}
                    timestamp={
                      teamOwned ? session.updated_at : (session.published_at ?? session.created_at)
                    }
                    timestampVerb={teamOwned ? 'updated' : 'published'}
                    metadata={
                      <div className="session-feed-row-meta">
                        <SessionSourceBadge provider={session.provider} />
                        {cost ? <span className="session-feed-cost">{cost}</span> : null}
                        <span title={`${stars} ${stars === 1 ? 'star' : 'stars'}`}>
                          <Star size={13} strokeWidth={1.7} aria-hidden="true" />
                          {compactNumber(stars)} {stars === 1 ? 'star' : 'stars'}
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
                <p role="alert">More Sessions could not be loaded. Your current list is intact.</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
      <Footer />
    </Page>
  )
}
