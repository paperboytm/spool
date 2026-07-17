import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import MarkdownContent from './markdown-content.js'

describe('MarkdownContent', () => {
  it('wraps long inline commands inside the message column', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        text={'Run `node "$SPOOL_HOME/.claude/plugins/cache/openai-codex/codex/scripts/codex-companion.mjs" setup --json`'}
        isDark={false}
      />,
    )

    expect(html).toContain('whitespace-pre-wrap break-all')
  })
})
