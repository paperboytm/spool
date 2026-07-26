import { Avatar, Button, SectionLabel } from '@spool-lab/ui'
import { Star, UserCheck, UserPlus, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Footer, Header, Page } from '../components/Chrome'
import { ProjectCard } from '../components/ProjectCard'
import { SessionFeedRow, SessionSourceBadge } from '../components/SessionFeedRow'
import { SessionLanguageToolbar } from '../components/SessionLanguageToggle'
import { appendUniqueManagedSessions } from '../lib/hub-management-api'
import { sessionLanguageTag, useSessionLanguage } from '../lib/language'
import { normalizeTabTitle } from '../lib/page-title'
import {
  fetchFollowers,
  fetchFollowing,
  fetchOwnerProjects,
  fetchOwnerStarredProjects,
  fetchUserFollow,
  setUserFollow,
  type ProjectOwnerPage,
  type ProjectSummary,
  type SocialIdentity,
  type UserFollowState,
} from '../lib/project-api'
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

export type ProfileTab = 'overview' | 'stars' | 'followers' | 'following'

type SocialListState =
  | { kind: 'idle' | 'loading' | 'error' }
  | { kind: 'projects'; projects: ProjectSummary[]; nextCursor: string | null }
  | { kind: 'people'; people: SocialIdentity[]; nextCursor: string | null }

export function Profile({ handle, tab = 'overview' }: { handle: string; tab?: ProfileTab }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [follow, setFollow] = useState<UserFollowState | null>(null)
  const [followPending, setFollowPending] = useState(false)
  const [socialList, setSocialList] = useState<SocialListState>({ kind: 'idle' })
  const [socialLoadingMore, setSocialLoadingMore] = useState(false)
  const [socialLoadMoreError, setSocialLoadMoreError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const requestIdRef = useRef(0)
  const socialRequestIdRef = useRef(0)
  const language = useSessionLanguage()

  useEffect(() => {
    const requestId = ++requestIdRef.current
    let cancelled = false
    setState({ kind: 'loading' })
    setFollow(null)
    setLoadingMore(false)
    setLoadMoreError(false)
    void fetchOwnerProjects(handle).then((result) => {
      if (cancelled || requestId !== requestIdRef.current) return
      if (result.kind === 'ok') {
        setState({ kind: 'ready', data: result.data })
        document.title = `${normalizeTabTitle(result.data.owner.name || `@${handle}`)} · spool.new`
        if (result.data.owner.kind === 'user') {
          void fetchUserFollow(handle).then((socialResult) => {
            if (cancelled || requestId !== requestIdRef.current) return
            if (socialResult.kind === 'ok') setFollow(socialResult.data)
          })
        }
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

  const ownerKind = state.kind === 'ready' ? state.data.owner.kind : null
  useEffect(() => {
    const requestId = ++socialRequestIdRef.current
    let cancelled = false
    if (tab === 'overview' || ownerKind !== 'user') {
      setSocialList({ kind: 'idle' })
      return
    }
    setSocialList({ kind: 'loading' })
    setSocialLoadingMore(false)
    setSocialLoadMoreError(false)
    const request =
      tab === 'stars'
        ? fetchOwnerStarredProjects(handle)
        : tab === 'followers'
          ? fetchFollowers(handle)
          : fetchFollowing(handle)
    void request.then((result) => {
      if (cancelled || requestId !== socialRequestIdRef.current) return
      if (result.kind !== 'ok') {
        setSocialList({ kind: 'error' })
        return
      }
      if (tab === 'stars' && 'projects' in result.data) {
        setSocialList({
          kind: 'projects',
          projects: result.data.projects,
          nextCursor: result.data.next_cursor,
        })
      } else if (tab === 'followers' && 'followers' in result.data) {
        setSocialList({
          kind: 'people',
          people: result.data.followers,
          nextCursor: result.data.next_cursor,
        })
      } else if (tab === 'following' && 'following' in result.data) {
        setSocialList({
          kind: 'people',
          people: result.data.following,
          nextCursor: result.data.next_cursor,
        })
      } else {
        setSocialList({ kind: 'error' })
      }
    })
    return () => {
      cancelled = true
    }
  }, [handle, ownerKind, tab])

  async function loadMoreSocial() {
    if (
      tab === 'overview' ||
      (socialList.kind !== 'projects' && socialList.kind !== 'people') ||
      socialList.nextCursor === null ||
      socialLoadingMore
    ) {
      return
    }
    const cursor = socialList.nextCursor
    const requestId = ++socialRequestIdRef.current
    setSocialLoadingMore(true)
    setSocialLoadMoreError(false)
    const result =
      tab === 'stars'
        ? await fetchOwnerStarredProjects(handle, cursor)
        : tab === 'followers'
          ? await fetchFollowers(handle, cursor)
          : await fetchFollowing(handle, cursor)
    if (requestId !== socialRequestIdRef.current) return
    setSocialLoadingMore(false)
    if (result.kind !== 'ok') {
      setSocialLoadMoreError(true)
      return
    }
    setSocialList((current) => {
      if (tab === 'stars' && current.kind === 'projects' && 'projects' in result.data) {
        return {
          kind: 'projects',
          projects: appendUniqueProjects(current.projects, result.data.projects),
          nextCursor: result.data.next_cursor,
        }
      }
      if (current.kind === 'people') {
        const people =
          tab === 'followers' && 'followers' in result.data
            ? result.data.followers
            : tab === 'following' && 'following' in result.data
              ? result.data.following
              : null
        if (people) {
          return {
            kind: 'people',
            people: appendUniquePeople(current.people, people),
            nextCursor: result.data.next_cursor,
          }
        }
      }
      return current
    })
  }

  async function loadMoreSessions() {
    if (state.kind !== 'ready' || state.data.next_cursor === null || loadingMore) {
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
  const sessions = state.data.sessions ?? []
  const sessionCount = state.data.session_count ?? sessions.length
  const teamOwned = owner.kind === 'team'
  const activeTab = teamOwned ? 'overview' : tab
  const hasBilingualSessions = sessions.some(
    (session) =>
      Boolean(session.titles?.en && session.titles.zh) ||
      Boolean(session.summaries?.en && session.summaries.zh),
  )
  return (
    <Page>
      <Header sticky />
      {hasBilingualSessions && activeTab === 'overview' ? <SessionLanguageToolbar /> : null}
      <main className="project-public-main">
        <header className="profile-project-header">
          <div className="profile-project-identity">
            <Avatar src={owner.avatar_url ?? null} name={owner.name} alt="" size="lg" />
            <div>
              <h1>{owner.name}</h1>
              <p>@{owner.handle}</p>
              <span className="profile-project-stats">
                {projects.length} {projects.length === 1 ? 'Project' : 'Projects'} · {sessionCount}{' '}
                Public {sessionCount === 1 ? 'Session' : 'Sessions'}
              </span>
            </div>
          </div>
          {!teamOwned && follow && !follow.viewerIsSelf ? (
            <Button
              type="button"
              size="sm"
              variant={follow.viewerFollowing ? 'outline' : 'accent'}
              aria-pressed={follow.viewerFollowing}
              loading={followPending}
              loadingLabel="Updating follow…"
              onClick={() => {
                if (followPending) return
                if (!follow.viewerAuthenticated) {
                  window.location.assign(`/sign-in?next=${encodeURIComponent(`/@${handle}`)}`)
                  return
                }
                if (!follow.canFollow) return
                setFollowPending(true)
                void setUserFollow(handle, !follow.viewerFollowing).then((result) => {
                  setFollowPending(false)
                  if (result.kind === 'ok') {
                    setFollow(result.data)
                  } else if (result.kind === 'unauthenticated') {
                    window.location.assign(`/sign-in?next=${encodeURIComponent(`/@${handle}`)}`)
                  }
                })
              }}
            >
              {follow.viewerFollowing ? (
                <UserCheck size={14} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <UserPlus size={14} strokeWidth={1.8} aria-hidden="true" />
              )}
              {follow.viewerFollowing ? 'Following' : 'Follow'}
            </Button>
          ) : null}
        </header>
        {!teamOwned ? (
          <nav className="profile-social-tabs" aria-label="Profile views">
            <ProfileTabLink handle={handle} tab="overview" active={activeTab}>
              Overview
            </ProfileTabLink>
            <ProfileTabLink handle={handle} tab="stars" active={activeTab}>
              Stars
            </ProfileTabLink>
            <ProfileTabLink handle={handle} tab="followers" active={activeTab}>
              Followers {follow ? <span>{follow.followerCount}</span> : null}
            </ProfileTabLink>
            <ProfileTabLink handle={handle} tab="following" active={activeTab}>
              Following {follow ? <span>{follow.followingCount}</span> : null}
            </ProfileTabLink>
          </nav>
        ) : null}
        {activeTab === 'overview' ? (
          <>
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
          </>
        ) : (
          <ProfileSocialList
            tab={activeTab}
            state={socialList}
            loadingMore={socialLoadingMore}
            loadMoreError={socialLoadMoreError}
            onLoadMore={() => void loadMoreSocial()}
          />
        )}
      </main>
      <Footer />
    </Page>
  )
}

function ProfileTabLink({
  handle,
  tab,
  active,
  children,
}: {
  handle: string
  tab: ProfileTab
  active: ProfileTab
  children: React.ReactNode
}) {
  const href =
    tab === 'overview'
      ? `/@${encodeURIComponent(handle)}`
      : `/@${encodeURIComponent(handle)}?tab=${tab}`
  return (
    <a href={href} aria-current={active === tab ? 'page' : undefined}>
      {children}
    </a>
  )
}

function ProfileSocialList({
  tab,
  state,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: {
  tab: Exclude<ProfileTab, 'overview'>
  state: SocialListState
  loadingMore: boolean
  loadMoreError: boolean
  onLoadMore: () => void
}) {
  const label =
    tab === 'stars' ? 'Starred Projects' : tab === 'followers' ? 'Followers' : 'Following'
  return (
    <section className="profile-social-list" aria-labelledby="profile-social-list-heading">
      <SectionLabel id="profile-social-list-heading" role="heading" aria-level={2}>
        {label}
      </SectionLabel>
      {state.kind === 'loading' || state.kind === 'idle' ? (
        <div className="projects-state" aria-busy="true">
          Loading {label}
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="projects-state" role="alert">
          <h2>Could not load {label.toLowerCase()}</h2>
          <p>Try refreshing this page.</p>
        </div>
      ) : null}
      {state.kind === 'projects' ? (
        state.projects.length === 0 ? (
          <div className="projects-state">
            <h2>No starred Projects yet</h2>
          </div>
        ) : (
          <div className="projects-list">
            {state.projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )
      ) : null}
      {state.kind === 'people' ? (
        state.people.length === 0 ? (
          <div className="projects-state">
            <h2>No {label.toLowerCase()} yet</h2>
          </div>
        ) : (
          <div className="profile-people-list">
            {state.people.map((person) => (
              <a key={person.id} href={`/@${encodeURIComponent(person.handle)}`}>
                <Avatar src={person.avatar_url} name={person.name} alt="" size="sm" />
                <span>
                  <strong>{person.name}</strong>
                  <small>@{person.handle}</small>
                </span>
                <Users size={15} strokeWidth={1.7} aria-hidden="true" />
              </a>
            ))}
          </div>
        )
      ) : null}
      {(state.kind === 'projects' || state.kind === 'people') &&
      (state.nextCursor !== null || loadMoreError) ? (
        <div className="projects-load-more">
          <Button
            variant="outline"
            loading={loadingMore}
            loadingLabel={`Loading more ${label.toLowerCase()}…`}
            onClick={onLoadMore}
          >
            {loadMoreError ? 'Try loading more again' : `Load more ${label.toLowerCase()}`}
          </Button>
          {loadMoreError ? <p role="alert">The current list is intact. Try again.</p> : null}
        </div>
      ) : null}
    </section>
  )
}

function appendUniqueProjects(
  current: readonly ProjectSummary[],
  incoming: readonly ProjectSummary[],
): ProjectSummary[] {
  const seen = new Set(current.map((project) => project.id))
  return [
    ...current,
    ...incoming.filter((project) => {
      if (seen.has(project.id)) return false
      seen.add(project.id)
      return true
    }),
  ]
}

function appendUniquePeople(
  current: readonly SocialIdentity[],
  incoming: readonly SocialIdentity[],
): SocialIdentity[] {
  const seen = new Set(current.map((person) => person.id))
  return [
    ...current,
    ...incoming.filter((person) => {
      if (seen.has(person.id)) return false
      seen.add(person.id)
      return true
    }),
  ]
}
