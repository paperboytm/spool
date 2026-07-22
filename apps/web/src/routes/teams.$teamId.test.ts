import { describe, expect, it } from 'vite-plus/test'

import { privateTeamHead } from './teams.$teamId'

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
