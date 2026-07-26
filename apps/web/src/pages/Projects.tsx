import { Button, ButtonLink, Tabs } from '@spool-lab/ui'
import { FolderKanban, LoaderCircle, Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ProjectCard } from '../components/ProjectCard'
import { WorkspaceFrame } from '../components/WorkspaceFrame'
import {
  fetchMyProjects,
  fetchMyStarredProjects,
  fetchMyWatchingProjects,
  fetchPublicProjects,
  fetchTeamProjects,
  type ProjectApiResult,
  type ProjectSummary,
} from '../lib/project-api'
import { fetchTeams, type TeamSummary } from '../lib/team-api'

import '../styles/projects.css'

export type ProjectsSearchState =
  | { scope?: 'public'; team?: never }
  | { scope: 'mine'; team?: never }
  | { scope: 'starred'; team?: never }
  | { scope: 'watching'; team?: never }
  | { scope: 'team'; team: string }

type Membership =
  | { kind: 'unknown' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; teams: TeamSummary[] }

type ProjectsState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      projects: ProjectSummary[]
      nextCursor: string | null
      loadingMore: boolean
      loadMoreError: boolean
    }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable'; message: string }

function resultState(
  result: ProjectApiResult<{ projects: ProjectSummary[]; next_cursor: string | null }>,
): Exclude<ProjectsState, { kind: 'loading' }> {
  if (result.kind === 'ok') {
    return {
      kind: 'ready',
      projects: result.data.projects,
      nextCursor: result.data.next_cursor,
      loadingMore: false,
      loadMoreError: false,
    }
  }
  if (result.kind === 'unauthenticated') return { kind: 'unauthenticated' }
  if (result.kind === 'forbidden' || result.kind === 'not-found') {
    return { kind: 'unavailable', message: 'This Project scope is not available.' }
  }
  return { kind: 'unavailable', message: 'Projects could not be loaded. Try again.' }
}

function scopeValue(search: ProjectsSearchState): string {
  if (search.scope === 'mine') return 'mine'
  if (search.scope === 'starred') return 'starred'
  if (search.scope === 'watching') return 'watching'
  if (search.scope === 'team') return `team:${search.team}`
  return 'public'
}

export function appendUniqueProjects(
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

export function ProjectsPage({
  search,
  onSearchChange,
}: {
  search: ProjectsSearchState
  onSearchChange: (next: ProjectsSearchState) => void
}) {
  const [membership, setMembership] = useState<Membership>({ kind: 'unknown' })
  const [state, setState] = useState<ProjectsState>({ kind: 'loading' })
  const requestIdRef = useRef(0)

  useEffect(() => {
    let alive = true
    void fetchTeams().then((result) => {
      if (!alive) return
      if (result.kind === 'ok') setMembership({ kind: 'ready', teams: result.data.teams })
      else if (result.kind === 'unauthenticated') setMembership({ kind: 'signed-out' })
      else setMembership({ kind: 'signed-out' })
    })
    return () => {
      alive = false
    }
  }, [])

  const activeTeam = useMemo(
    () =>
      search.scope === 'team' && membership.kind === 'ready'
        ? membership.teams.find((team) => team.id === search.team)
        : undefined,
    [membership, search],
  )

  const fetchPage = useCallback(
    (cursor: string | null = null) => {
      if (search.scope === 'mine') return fetchMyProjects(cursor)
      if (search.scope === 'starred') return fetchMyStarredProjects(cursor)
      if (search.scope === 'watching') return fetchMyWatchingProjects(cursor)
      if (search.scope === 'team') {
        if (!activeTeam) return null
        return fetchTeamProjects(activeTeam.id, cursor)
      }
      return fetchPublicProjects(cursor)
    },
    [activeTeam, search.scope],
  )

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setState({ kind: 'loading' })
    if (search.scope === 'team') {
      if (membership.kind === 'unknown') return
      if (!activeTeam) {
        if (requestId === requestIdRef.current) {
          setState({ kind: 'unavailable', message: 'This Project scope is not available.' })
        }
        return
      }
    }
    const request = fetchPage()
    if (request === null) return
    const result = await request
    if (requestId === requestIdRef.current) setState(resultState(result))
  }, [activeTeam, fetchPage, membership.kind, search.scope])

  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready' || state.nextCursor === null || state.loadingMore) return
    const requestId = ++requestIdRef.current
    const cursor = state.nextCursor
    setState({ ...state, loadingMore: true, loadMoreError: false })
    const request = fetchPage(cursor)
    if (request === null) {
      if (requestId === requestIdRef.current) {
        setState({ ...state, loadingMore: false, loadMoreError: true })
      }
      return
    }
    const result = await request
    if (requestId !== requestIdRef.current) return
    if (result.kind !== 'ok') {
      setState({ ...state, loadingMore: false, loadMoreError: true })
      return
    }
    setState((current) => {
      if (current.kind !== 'ready') return current
      return {
        kind: 'ready',
        projects: appendUniqueProjects(current.projects, result.data.projects),
        nextCursor: result.data.next_cursor,
        loadingMore: false,
        loadMoreError: false,
      }
    })
  }, [fetchPage, state])

  useEffect(() => {
    void load()
  }, [load])

  const scope = scopeValue(search)
  const tabs =
    membership.kind === 'ready'
      ? [
          { value: 'public', label: 'Public' },
          { value: 'starred', label: 'Starred' },
          { value: 'watching', label: 'Watching' },
          ...membership.teams.map((team) => ({
            value: `team:${team.id}`,
            label: (
              <span className="projects-scope-label" title={`Team · ${team.name}`}>
                Team · {team.name}
              </span>
            ),
          })),
          { value: 'mine', label: 'Mine' },
        ]
      : [{ value: 'public', label: 'Public' }]

  const mayCreate =
    search.scope === 'mine' ||
    (activeTeam !== undefined &&
      (activeTeam.permissions.includes('projects:manage') ||
        activeTeam.role === 'owner' ||
        activeTeam.role === 'admin'))
  const createHref =
    search.scope === 'team' && activeTeam
      ? `/projects/new?team=${encodeURIComponent(activeTeam.id)}`
      : '/projects/new'

  return (
    <WorkspaceFrame active="projects" rootClassName="projects-root" mainClassName="projects-main">
      <header className="projects-toolbar">
        <Tabs
          className="projects-scope-tabs"
          aria-label="Project scope"
          value={scope}
          items={tabs.map((item) => ({
            ...item,
            ariaControls: 'projects-results',
          }))}
          onValueChange={(value) => {
            if (value === 'mine') return onSearchChange({ scope: 'mine' })
            if (value === 'starred') return onSearchChange({ scope: 'starred' })
            if (value === 'watching') return onSearchChange({ scope: 'watching' })
            if (value.startsWith('team:')) {
              return onSearchChange({ scope: 'team', team: value.slice('team:'.length) })
            }
            onSearchChange({ scope: 'public' })
          }}
        />
        {mayCreate ? (
          <ButtonLink href={createHref} size="sm" variant="accent">
            <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            New Project
          </ButtonLink>
        ) : null}
      </header>
      <section id="projects-results" className="projects-results" aria-live="polite">
        {state.kind === 'loading' ? (
          <div className="projects-state" aria-busy="true">
            <LoaderCircle className="projects-spin" size={20} aria-hidden="true" />
            <span>Loading Projects</span>
          </div>
        ) : null}
        {state.kind === 'unauthenticated' ? (
          <div className="projects-state">
            <FolderKanban size={22} strokeWidth={1.6} aria-hidden="true" />
            <h1>Sign in to see your Projects</h1>
            <p>Personal and Team Projects are shown only to their current members.</p>
            <ButtonLink href="/sign-in?next=%2Fprojects%3Fscope%3Dmine" variant="accent">
              Sign in
            </ButtonLink>
          </div>
        ) : null}
        {state.kind === 'unavailable' ? (
          <div className="projects-state" role="alert">
            <FolderKanban size={22} strokeWidth={1.6} aria-hidden="true" />
            <h1>Projects unavailable</h1>
            <p>{state.message}</p>
            <Button variant="outline" onClick={() => void load()}>
              <RotateCcw size={14} aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : null}
        {state.kind === 'ready' && state.projects.length === 0 ? (
          <div className="projects-state">
            <FolderKanban size={22} strokeWidth={1.6} aria-hidden="true" />
            <h1>No Projects here yet</h1>
            <p>
              {search.scope === 'public'
                ? 'Public Projects appear after they contain a Public Session.'
                : search.scope === 'starred'
                  ? 'Star a Project to keep it in this list.'
                  : search.scope === 'watching'
                    ? 'Watch a Project to keep up with its Sessions.'
                    : 'Create a Project to give related Sessions one clear home.'}
            </p>
            {mayCreate ? (
              <ButtonLink href={createHref} variant="accent">
                Create a Project
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
        {state.kind === 'ready' && state.projects.length > 0 ? (
          <>
            <div className="projects-list">
              {state.projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
            {state.nextCursor !== null || state.loadMoreError ? (
              <div className="projects-load-more">
                <Button
                  variant="outline"
                  loading={state.loadingMore}
                  loadingLabel="Loading more Projects…"
                  onClick={() => void loadMore()}
                >
                  {state.loadMoreError ? 'Try loading more again' : 'Load more Projects'}
                </Button>
                {state.loadMoreError ? (
                  <p role="alert">
                    More Projects could not be loaded. Your current list is intact.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </WorkspaceFrame>
  )
}
