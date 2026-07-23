import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { SignInEmblem } from './SignIn'

describe('SignInEmblem', () => {
  it('uses the current public Spool mark instead of the legacy cylinder', () => {
    const html = renderToStaticMarkup(<SignInEmblem />)

    expect(html).toContain('class="sw-signin-emblem"')
    expect(html).toContain('cy="7.2"')
    expect(html).toContain('fill="currentColor"')
    expect(html).not.toContain('cy="9"')
  })
})
