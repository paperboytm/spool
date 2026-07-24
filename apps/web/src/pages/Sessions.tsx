import { Tabs } from '@spool-lab/ui'
import { useEffect, useState } from 'react'

import { ManagedSessionsSection } from '../components/ManagedSessionsSection'
import { WorkspaceFrame } from '../components/WorkspaceFrame'
import { type DiscoveryAgentFilter, type SessionsSearchState } from '../lib/discovery'
import { fetchTeams, type TeamSummary } from '../lib/team-api'
import { changedAgentSearch, PublicFeed, PublicFeedRail } from './Explore'
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
  if (value === 'mine') return { sort: 'recommended', scope: 'mine' }
  if (value.startsWith('team:')) {
    return { sort: 'recommended', scope: 'team', team: value.slice('team:'.length) }
  }
  return { sort: 'recommended' }
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
    { value: 'public', label: 'Public' },
    ...membership.teams.map((team) => ({
      value: `team:${team.id}`,
      label: `Team · ${team.name}`,
    })),
    { value: 'mine', label: 'Mine' },
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

  return <TeamSessionsPanel team={team} />
}

export function SessionsPage({ search, onSearchChange }: SessionsPageProps) {
  const membership = useScopeMembership()
  const scope = search.scope ?? 'public'
  const isPublic = scope === 'public'

  const changeAgent = (agent?: DiscoveryAgentFilter) => {
    onSearchChange(changedAgentSearch(search, agent))
  }

  return (
    <WorkspaceFrame
      active="feed"
      layout={isPublic ? 'feed' : 'wide'}
      rootClassName="explore-root"
      mainClassName={isPublic ? 'explore-center' : 'workspace-content-main'}
      {...(isPublic
        ? { rightRail: <PublicFeedRail search={search} onAgentChange={changeAgent} /> }
        : {})}
    >
      <ScopeTabs search={search} membership={membership} onSearchChange={onSearchChange} />
      {scope === 'public' ? <PublicFeed search={search} onSearchChange={onSearchChange} /> : null}
      {scope === 'mine' ? (
        <section aria-label="Your Sessions">
          <ManagedSessionsSection signInNext="/sessions?scope=mine" />
        </section>
      ) : null}
      {scope === 'team' && search.team ? (
        <TeamScopeBody teamId={search.team} membership={membership} />
      ) : null}
    </WorkspaceFrame>
  )
}
