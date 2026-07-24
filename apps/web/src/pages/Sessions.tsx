import { Tabs } from '@spool-lab/ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ManagedSessionsSection } from '../components/ManagedSessionsSection'
import { WorkspaceFrame } from '../components/WorkspaceFrame'
import { type SessionsSearchState } from '../lib/discovery'
import { fetchTeams, type TeamSummary } from '../lib/team-api'
import { PublicFeed } from './Explore'
import { TeamSessionsPanel } from './Team'

import '../styles/app.css'

interface SessionsPageProps {
  search: SessionsSearchState
  onSearchChange: (next: SessionsSearchState) => void
}

type ScopeMembership =
  | { kind: 'unknown' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; teams: TeamSummary[] }

/**
 * Scope tabs only exist once the server has confirmed membership: signed-out
 * visitors read the Public feed without a switcher, and Team tabs never
 * render from navigation state alone.
 */
function useScopeMembership(): ScopeMembership {
  const [membership, setMembership] = useState<ScopeMembership>({ kind: 'unknown' })

  useEffect(() => {
    let alive = true
    void fetchTeams().then((result) => {
      if (!alive) return
      if (result.kind === 'ok') {
        setMembership({ kind: 'ready', teams: result.data.teams })
      } else if (result.kind === 'unauthenticated') {
        setMembership({ kind: 'signed-out' })
      } else {
        // Transient failure: keep the Public feed usable without tabs.
        setMembership({ kind: 'signed-out' })
      }
    })
    return () => {
      alive = false
    }
  }, [])

  return membership
}

export function scopeTabValue(search: SessionsSearchState): string {
  if (search.scope === 'mine') return 'mine'
  if (search.scope === 'team' && search.team) return `team:${search.team}`
  return 'public'
}

export function scopeSearchForTab(value: string): SessionsSearchState {
  if (value === 'mine') return { sort: 'recent', scope: 'mine' }
  if (value.startsWith('team:')) {
    return { sort: 'recent', scope: 'team', team: value.slice('team:'.length) }
  }
  return { sort: 'recommended' }
}

function scopeTabId(value: string): string {
  return `sessions-scope-${encodeURIComponent(value)}-tab`
}

function scopePanelId(value: string): string {
  return `sessions-scope-${encodeURIComponent(value)}-panel`
}

function ScopeTabs({
  search,
  membership,
  onSearchChange,
}: {
  search: SessionsSearchState
  membership: ScopeMembership
  onSearchChange: (next: SessionsSearchState) => void
}) {
  if (membership.kind !== 'ready') return null

  const items = [
    {
      value: 'public',
      label: 'Public',
      id: scopeTabId('public'),
      ariaControls: scopePanelId('public'),
    },
    ...membership.teams.map((team) => ({
      value: `team:${team.id}`,
      label: (
        <span className="sessions-scope-tab-label" title={`Team · ${team.name}`}>
          Team · {team.name}
        </span>
      ),
      id: scopeTabId(`team:${team.id}`),
      ariaControls: scopePanelId(`team:${team.id}`),
    })),
    {
      value: 'mine',
      label: 'Mine',
      id: scopeTabId('mine'),
      ariaControls: scopePanelId('mine'),
    },
  ]

  return (
    <Tabs
      className="sessions-scope-tabs"
      aria-label="Session scope"
      value={scopeTabValue(search)}
      items={items}
      onValueChange={(value) => onSearchChange(scopeSearchForTab(value))}
    />
  )
}

function ScopePanel({
  value,
  labelled,
  children,
}: {
  value: string
  labelled: boolean
  children: ReactNode
}) {
  return (
    <div
      id={scopePanelId(value)}
      className="sessions-scope-panel"
      role={labelled ? 'tabpanel' : undefined}
      aria-labelledby={labelled ? scopeTabId(value) : undefined}
    >
      {children}
    </div>
  )
}

function TeamScopeBody({ teamId, membership }: { teamId: string; membership: ScopeMembership }) {
  if (membership.kind === 'unknown') {
    return (
      <p className="sessions-scope-state" aria-busy="true">
        Checking your Team access…
      </p>
    )
  }

  const team =
    membership.kind === 'ready'
      ? membership.teams.find((candidate) => candidate.id === teamId)
      : undefined

  if (!team) {
    // Same treatment for signed-out and non-member: never confirm which
    // Team owns the scope in a URL someone pasted around.
    return (
      <div className="sessions-scope-state">
        <h2>This Team feed is not available</h2>
        <p>
          Sign in with a member account, or open <a href="/teams">your Teams</a> to pick a workspace
          you belong to.
        </p>
      </div>
    )
  }

  return <TeamSessionsPanel team={team} presentation="feed" />
}

function RecentFeedHeader() {
  return (
    <div className="sessions-feed-order" aria-label="Session order">
      <span>Recent</span>
    </div>
  )
}

export function SessionsPage({ search, onSearchChange }: SessionsPageProps) {
  const membership = useScopeMembership()
  const requestedScope = search.scope ?? 'public'
  const invalidTeamScope =
    requestedScope === 'team' &&
    Boolean(search.team) &&
    membership.kind === 'ready' &&
    !membership.teams.some((team) => team.id === search.team)
  const normalizedTeamRef = useRef<string | null>(null)

  useEffect(() => {
    if (!invalidTeamScope || !search.team) {
      normalizedTeamRef.current = null
      return
    }
    if (normalizedTeamRef.current === search.team) return
    normalizedTeamRef.current = search.team
    onSearchChange({ sort: 'recommended' })
  }, [invalidTeamScope, onSearchChange, search.team])

  const scope = invalidTeamScope ? 'public' : requestedScope
  const activeSearch: SessionsSearchState = invalidTeamScope ? { sort: 'recommended' } : search
  const hasScopeTabs = membership.kind === 'ready'

  return (
    <WorkspaceFrame active="feed" rootClassName="explore-root" mainClassName="explore-center">
      <ScopeTabs search={activeSearch} membership={membership} onSearchChange={onSearchChange} />
      {scope === 'public' ? (
        <ScopePanel value="public" labelled={hasScopeTabs}>
          <PublicFeed search={activeSearch} onSearchChange={onSearchChange} />
        </ScopePanel>
      ) : null}
      {scope === 'mine' ? (
        <ScopePanel value="mine" labelled={hasScopeTabs}>
          <RecentFeedHeader />
          <ManagedSessionsSection presentation="feed" signInNext="/sessions?scope=mine" />
        </ScopePanel>
      ) : null}
      {scope === 'team' && search.team ? (
        <ScopePanel value={hasScopeTabs ? `team:${search.team}` : 'team'} labelled={hasScopeTabs}>
          <RecentFeedHeader />
          <TeamScopeBody teamId={search.team} membership={membership} />
        </ScopePanel>
      ) : null}
    </WorkspaceFrame>
  )
}
