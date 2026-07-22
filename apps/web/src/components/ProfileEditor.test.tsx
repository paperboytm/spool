import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import type { MeResponse } from '../lib/api'
import { ProfileEditor } from './ProfileEditor'

function profile(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 'user_12345678',
    email: 'alice@example.com',
    name: 'Alice',
    display_name: 'Alice Example',
    display_name_override: null,
    avatar_url: null,
    custom_avatar_id: null,
    avatar_visible: true,
    handle: 'alice',
    deletion_pending_until: null,
    ...overrides,
  }
}

describe('ProfileEditor avatar', () => {
  it('renders the shared fallback when no avatar URL is available', () => {
    const html = renderToStaticMarkup(<ProfileEditor me={profile()} onChanged={() => undefined} />)

    expect(html).toContain('sp-avatar__fallback')
    expect(html).toContain('AE')
    expect(html).not.toContain('<img')
  })

  it('keeps the resolved WorkOS image and no-referrer policy', () => {
    const src = 'https://images.workoscdn.com/images/v1/profile.png'
    const html = renderToStaticMarkup(
      <ProfileEditor me={profile({ avatar_url: src })} onChanged={() => undefined} />,
    )

    expect(html).toContain(`src="${src}"`)
    expect(html).toContain('referrerPolicy="no-referrer"')
  })
})
