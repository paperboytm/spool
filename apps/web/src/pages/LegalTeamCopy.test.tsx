import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { Privacy } from './Privacy'
import { Terms } from './Terms'

describe('Team legal copy', () => {
  it('documents Team data, access, disclosure controls, and retention in Privacy', () => {
    const html = renderToStaticMarkup(<Privacy />)

    expect(html).toContain('Last updated: July 22, 2026')
    expect(html).toContain('Team and invitation information')
    expect(html).toContain('Team-only')
    expect(html).toContain('Team Owners and Admins')
    expect(html).toContain('Accepted, revoked, and expired invitations')
    expect(html).toContain('author can later explicitly Share the same Session again')
    expect(html).toContain('Withdrawing a Team-owned Session')
    expect(html).toContain('no member can revive it')
    expect(html).toContain('does not delete Team-owned Sessions')
    expect(html).toContain('Team-owned assets remain with the Team')
    expect(html).toContain('does not delete assets owned by a Team')
  })

  it('documents Team roles, hosted-asset ownership, and all visibility levels in Terms', () => {
    const html = renderToStaticMarkup(<Terms />)

    expect(html).toContain('Last updated: July 22, 2026')
    expect(html).toContain('Teams, roles, and invitations')
    expect(html).toContain('transfers ownership and control of the hosted Spool asset')
    expect(html).toContain('Team Owners and Admins may later change')
    expect(html).toContain('author may later explicitly Share the same Session again')
    expect(html).toContain('Withdrawing a Team-owned Session is permanent')
    expect(html).toContain('no Team member can revive it')
    expect(html).toContain('Public')
    expect(html).toContain('Link-only')
    expect(html).toContain('Team-only')
    expect(html).toContain(
      'deleting an individual account does not withdraw or delete Team-owned assets',
    )
  })
})
