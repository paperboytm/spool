import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import type { TeamInvitation, TeamMember } from '../lib/team-api'
import {
  createTeamInvitationIntent,
  memberRemovalConfirmation,
  memberRoleConfirmation,
  pendingTeamInvitations,
  teamDuringOwnerMutation,
  TeamMemberActions,
  TeamTabs,
} from './Team'

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    user_id: 'user_12345678',
    email: 'alice@example.com',
    display_name: 'Alice',
    role: 'member',
    joined_at: 1,
    permissions: [],
    ...overrides,
  }
}

describe('TeamTabs', () => {
  it('exposes the selected tab and its controlled panel', () => {
    const html = renderToStaticMarkup(<TeamTabs value="members" onChange={() => undefined} />)

    expect(html).toContain('aria-label="Team sections"')
    expect(html).toContain('aria-controls="team-panel-members"')
    expect(html).toMatch(/aria-controls="team-panel-members" aria-selected="true"/)
    expect(html).toContain('aria-controls="team-panel-sessions" aria-selected="false"')
  })
})

describe('TeamMemberActions', () => {
  it('renders no mutation controls without server-computed row permissions', () => {
    const html = renderToStaticMarkup(
      <TeamMemberActions
        member={member()}
        busy={false}
        onRoleChange={() => undefined}
        onRemove={() => undefined}
      />,
    )

    expect(html).toContain('Member')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('Remove')
  })

  it('offers Owner only when the row grants ownership transfer', () => {
    const html = renderToStaticMarkup(
      <TeamMemberActions
        member={member({ permissions: ['ownership:transfer'] })}
        busy={false}
        onRoleChange={() => undefined}
        onRemove={() => undefined}
      />,
    )

    expect(html).toContain('<option value="owner">Owner</option>')
    expect(html).not.toContain('Remove')
  })

  it('shows only the independent actions granted for that member', () => {
    const html = renderToStaticMarkup(
      <TeamMemberActions
        member={member({ permissions: ['role:update', 'remove'] })}
        busy={false}
        onRoleChange={() => undefined}
        onRemove={() => undefined}
      />,
    )

    expect(html).toContain('<select')
    expect(html).toContain('Admin')
    expect(html).toContain('Remove')
    expect(html).not.toContain('<option value="owner">Owner</option>')
  })
})

describe('member confirmations', () => {
  it('names both sides of an ownership transfer', () => {
    const message = memberRoleConfirmation('Paperboy', member({ display_name: 'Bob' }), 'owner')

    expect(message).toContain('Transfer ownership of Paperboy to Bob')
    expect(message).toContain('They become the Owner')
    expect(message).toContain('your role changes to Admin')
  })

  it('explains the access impact before member removal', () => {
    const message = memberRemovalConfirmation('Paperboy', member({ display_name: 'Bob' }))

    expect(message).toContain('immediately lose access to every Team Session')
    expect(message).toContain('Team-owned Sessions remain with the Team')
  })
})

describe('owner mutation capability state', () => {
  const team = {
    id: 'team_1',
    name: 'Paperboy',
    role: 'owner' as const,
    permissions: [
      'team:update' as const,
      'team:archive' as const,
      'members:manage' as const,
      'team:leave' as const,
    ],
  }

  it('removes stale Leave while an owner removal or demotion refreshes', () => {
    expect(teamDuringOwnerMutation(team, 'owner', 'admin').permissions).not.toContain('team:leave')
    expect(teamDuringOwnerMutation(team, 'owner', null).permissions).not.toContain('team:leave')
  })

  it('clears actor capabilities while an ownership transfer refreshes the new role', () => {
    expect(teamDuringOwnerMutation(team, 'member', 'owner')).toMatchObject({
      role: null,
      permissions: [],
    })
  })
})

describe('pendingTeamInvitations', () => {
  it('never offers resend or revoke for terminal invitations', () => {
    const invitations: TeamInvitation[] = [
      { id: '1', email: 'pending@example.com', role: 'member', status: 'pending' },
      { id: '2', email: 'accepted@example.com', role: 'member', status: 'accepted' },
      { id: '3', email: 'revoked@example.com', role: 'admin', status: 'revoked' },
      { id: '4', email: 'expired@example.com', role: 'member', status: 'expired' },
    ]

    expect(pendingTeamInvitations(invitations).map((invitation) => invitation.id)).toEqual(['1'])
  })
})

describe('Team invitation intent', () => {
  it('reuses one key for retries and rotates only when the form intent resets', () => {
    const keys = ['team-invite-intent-0001', 'team-invite-intent-0002']
    const intent = createTeamInvitationIntent(() => keys.shift()!)

    const firstAttempt = intent.currentKey()
    expect(intent.currentKey()).toBe(firstAttempt)

    intent.reset()
    const nextIntent = intent.currentKey()
    expect(nextIntent).not.toBe(firstAttempt)
    expect(intent.currentKey()).toBe(nextIntent)
  })

  it('generates a backend-valid key by default', () => {
    expect(createTeamInvitationIntent().currentKey()).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
  })
})
