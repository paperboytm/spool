import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import type { ManagedSession } from '../lib/hub-management-api'
import {
  canManageSession,
  canPublishManagedSession,
  ManagedSessionList,
  visibilityConfirmation,
  withoutManagedSession,
  withdrawalConfirmation,
  withdrawalFailureMessage,
} from './ManagedSessionList'

const session: ManagedSession = {
  sid: 'codex_1',
  title: 'Ship Team workspaces',
  titles: null,
  summary: 'Implemented tenant-scoped Sessions.',
  summaries: null,
  cost: { usd: 1.25, totalTokens: 800_000 },
  star_count: 3,
  provider: 'codex',
  created_at: 1,
  updated_at: 2,
  visibility: 'public',
  team_id: null,
  team_name: null,
  can_manage_visibility: true,
  author: { handle: 'alice', display_name: 'Alice', avatar_url: null },
}

describe('ManagedSessionList', () => {
  it('uses the shared feed hierarchy and keeps management behind a quiet trigger', () => {
    const html = renderToStaticMarkup(
      <ManagedSessionList
        sessions={[session]}
        teams={[
          { id: 'team_1', name: 'Paperboy', permissions: [] },
          { id: 'team_2', name: 'Docs', permissions: [] },
        ]}
        canManageVisibility
        onSessionChanged={() => undefined}
        onSessionWithdrawn={() => undefined}
      />,
    )

    expect(html).toContain('session-feed-row')
    expect(html).toContain('@alice')
    expect(html).toContain('Codex CLI')
    expect(html).toContain('$1.25 · 800K tokens')
    expect(html).toContain('3 stars')
    expect(html).toContain('Public')
    expect(html).toContain('Manage Ship Team workspaces')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('Withdraw')
    expect(html).toContain('href="/session/codex_1"')
  })

  it('renders the localized task title when bilingual Summary titles are available', () => {
    const previous = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'zh-CN' },
    })
    try {
      const html = renderToStaticMarkup(
        <ManagedSessionList
          sessions={[
            {
              ...session,
              titles: {
                en: 'Ship Team workspaces',
                zh: '交付团队工作区',
              },
              summary: 'Legacy fallback Summary.',
              summaries: {
                en: 'English background, motivation, and result.',
                zh: '中文背景、动机和结果。',
              },
            },
          ]}
          teams={[]}
          canManageVisibility
          onSessionChanged={() => undefined}
          onSessionWithdrawn={() => undefined}
        />,
      )

      // Server rendering intentionally stays English for hydration safety;
      // the browser reconciles through useSyncExternalStore after hydration.
      expect(html).toContain('Ship Team workspaces')
      expect(html).toContain('English background, motivation, and result.')
      expect(html).not.toContain('Legacy fallback Summary.')
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: previous,
      })
    }
  })

  it('renders legacy managed responses safely during a rolling backend upgrade', () => {
    const {
      titles: _titles,
      summaries: _summaries,
      cost: _cost,
      star_count: _starCount,
      ...legacySession
    } = session
    const html = renderToStaticMarkup(
      <ManagedSessionList
        sessions={[legacySession]}
        teams={[]}
        canManageVisibility
        onSessionChanged={() => undefined}
        onSessionWithdrawn={() => undefined}
      />,
    )

    expect(html).toContain('0 stars')
    expect(html).not.toContain('NaN')
  })

  it('keeps management controls hidden when the Session permission is absent', () => {
    const html = renderToStaticMarkup(
      <ManagedSessionList
        sessions={[
          {
            ...session,
            visibility: 'team',
            team_id: 'team_1',
            team_name: 'Paperboy',
            can_manage_visibility: false,
          },
        ]}
        teams={[{ id: 'team_1', name: 'Paperboy', permissions: [] }]}
        canManageVisibility
        onSessionChanged={() => undefined}
        onSessionWithdrawn={() => undefined}
      />,
    )

    expect(html).toContain('Team · Paperboy')
    expect(html).toContain('$1.25 · 800K tokens')
    expect(html).not.toContain('3 stars')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('Manage Ship Team workspaces')
    expect(html).not.toContain('Withdraw')
  })

  it('keeps management controls hidden when the active surface lacks permission', () => {
    const html = renderToStaticMarkup(
      <ManagedSessionList
        sessions={[session]}
        teams={[]}
        canManageVisibility={false}
        onSessionChanged={() => undefined}
        onSessionWithdrawn={() => undefined}
      />,
    )

    expect(html).not.toContain('<select')
    expect(html).not.toContain('Manage Ship Team workspaces')
    expect(html).not.toContain('Withdraw')
  })

  it('does not trust a stale per-Session permission after a Member transfers ownership', () => {
    const transferred = {
      ...session,
      visibility: 'team' as const,
      team_id: 'team_1',
      team_name: 'Paperboy',
      can_manage_visibility: true,
    }
    const memberTeams = [
      {
        id: 'team_1',
        name: 'Paperboy',
        role: 'member' as const,
        permissions: ['team:leave' as const],
      },
    ]

    expect(canManageSession(transferred, memberTeams, true)).toBe(false)
    const html = renderToStaticMarkup(
      <ManagedSessionList
        sessions={[transferred]}
        teams={memberTeams}
        canManageVisibility
        onSessionChanged={() => undefined}
        onSessionWithdrawn={() => undefined}
      />,
    )
    expect(html).not.toContain('<select')
    expect(html).not.toContain('Manage Ship Team workspaces')
    expect(html).not.toContain('Withdraw')
  })

  it('does not offer an unsupported Public transition', () => {
    const unsupported = {
      ...session,
      sid: 'gemini_1',
      provider: 'gemini',
      visibility: 'link-only' as const,
    }

    expect(canPublishManagedSession(unsupported)).toBe(false)
    const html = renderToStaticMarkup(
      <ManagedSessionList
        sessions={[unsupported]}
        teams={[]}
        canManageVisibility
        onSessionChanged={() => undefined}
        onSessionWithdrawn={() => undefined}
      />,
    )
    expect(html).toContain('Link-only')
    expect(html).toContain('Gemini CLI')
    expect(html).toContain('$1.25 · 800K tokens')
    expect(html).not.toContain('3 stars')
    expect(html).not.toContain('<select')
  })
})

describe('withdrawalConfirmation', () => {
  it('allows an author to explicitly Share a personal Session again', () => {
    const message = withdrawalConfirmation(session)

    expect(message).toContain('current hosted copy')
    expect(message).toContain('410 Gone')
    expect(message).toContain('Changing visibility cannot restore it')
    expect(message).toContain('explicitly Share this Session again later')
    expect(message).not.toContain('permanently removes')
  })

  it('states permanent 410 and Team asset removal', () => {
    const message = withdrawalConfirmation({
      ...session,
      visibility: 'team',
      team_id: 'team_1',
      team_name: 'Paperboy',
    })

    expect(message).toContain('permanently removes the Team Session from the workspace')
    expect(message).toContain('410 Gone')
    expect(message).toContain('every member loses access')
    expect(message).toContain('changing visibility cannot restore it')
    expect(message).toContain('No member can revive it by submitting a new Session head')
    expect(message).not.toContain('Share this Session again')
  })
})

describe('withdrawalFailureMessage', () => {
  it('maps authorization, lifecycle, and throttling failures explicitly', () => {
    expect(withdrawalFailureMessage({ kind: 'forbidden' })).toContain('cannot withdraw')
    expect(withdrawalFailureMessage({ kind: 'not-found' })).toContain('no longer have access')
    expect(withdrawalFailureMessage({ kind: 'gone' })).toContain('already been withdrawn')
    expect(withdrawalFailureMessage({ kind: 'rate-limited' })).toContain('Wait a moment')
  })
})

describe('withoutManagedSession', () => {
  it('removes a successfully withdrawn Session from the current list', () => {
    expect(withoutManagedSession([session, { ...session, sid: 'codex_2' }], session.sid)).toEqual([
      { ...session, sid: 'codex_2' },
    ])
  })
})

describe('visibilityConfirmation', () => {
  it('states ownership transfer and durable Team retention', () => {
    const message = visibilityConfirmation(session, {
      visibility: 'team',
      teamId: 'team_1',
      teamName: 'Paperboy',
    })

    expect(message).toContain('transfers ownership')
    expect(message).toContain('removed from Explore')
    expect(message).toContain('keeps the Session if you later leave')
  })

  it('states public-discovery impact while retaining Team ownership', () => {
    const message = visibilityConfirmation(
      { ...session, visibility: 'team', team_id: 'team_1', team_name: 'Paperboy' },
      { visibility: 'public' },
    )

    expect(message).toContain('Anyone can read it')
    expect(message).toContain('may appear in Explore')
    expect(message).toContain('remains owned by Team · Paperboy')
  })
})
