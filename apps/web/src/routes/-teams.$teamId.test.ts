import { describe, expect, it } from 'vite-plus/test'

import { parseTeamSearch, privateTeamHead } from './teams.$teamId'

describe('private Team route metadata', () => {
  it('prevents tenant workspace URLs from being indexed or previewed as public content', () => {
    const head = privateTeamHead()

    expect(head.meta).toContainEqual({ title: 'Team · spool.new' })
    expect(head.meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow, noarchive',
    })
    expect(JSON.stringify(head)).not.toContain('"property":"og:')
  })
})

describe('Team route sections', () => {
  it('keeps each workspace section addressable without trusting arbitrary search state', () => {
    expect(parseTeamSearch({ section: 'projects' })).toEqual({ section: 'projects' })
    expect(parseTeamSearch({ section: 'members' })).toEqual({ section: 'members' })
    expect(parseTeamSearch({ section: 'settings' })).toEqual({ section: 'settings' })
    expect(parseTeamSearch({ section: 'sessions' })).toEqual({})
    expect(parseTeamSearch({ section: 'billing' })).toEqual({})
  })
})
