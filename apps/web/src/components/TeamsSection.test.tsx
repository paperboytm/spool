import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { createTeamCreateIntent, TeamList } from './TeamsSection'

describe('TeamList', () => {
  it('renders a clear empty state', () => {
    const html = renderToStaticMarkup(<TeamList teams={[]} />)

    expect(html).toContain('No teams yet')
    expect(html).toContain('only with current members')
  })

  it('links every team by encoded immutable id', () => {
    const html = renderToStaticMarkup(
      <TeamList
        teams={[
          {
            id: 'team/a',
            name: 'Paperboy',
            role: 'owner',
            member_count: 3,
            permissions: ['team:update'],
          },
        ]}
      />,
    )

    expect(html).toContain('href="/teams/team%2Fa"')
    expect(html).toContain('Paperboy')
    expect(html).toContain('3 members')
    expect(html).toContain('Owner')
    expect(html).toContain('sw-teams-list-role')
    expect(html).toContain('sw-teams-list-arrow')
  })
})

describe('Team create intent', () => {
  it('reuses one key for retries and rotates after editing or success', () => {
    const keys = ['team-create-intent-0001', 'team-create-intent-0002', 'team-create-intent-0003']
    const intent = createTeamCreateIntent(() => keys.shift()!)

    intent.started()
    const firstAttempt = intent.currentKey()
    expect(intent.currentKey()).toBe(firstAttempt)

    intent.nameEdited()
    const editedAttempt = intent.currentKey()
    expect(editedAttempt).not.toBe(firstAttempt)
    expect(intent.currentKey()).toBe(editedAttempt)

    intent.succeeded()
    expect(intent.currentKey()).not.toBe(editedAttempt)
  })

  it('generates a backend-valid key by default', () => {
    expect(createTeamCreateIntent().currentKey()).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
  })
})
