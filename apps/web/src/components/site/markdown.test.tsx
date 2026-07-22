import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { Markdown } from './markdown'

describe('site Markdown code blocks', () => {
  it('adds one copy control per fenced block while leaving inline code alone', () => {
    const html = renderToStaticMarkup(
      <Markdown copyCode>
        {['Run `spool` from the project.', '', '```bash', 'spool', 'spool list -n 10', '```'].join(
          '\n',
        )}
      </Markdown>,
    )

    expect(html.match(/aria-label="Copy code"/g)).toHaveLength(1)
    expect(html).toContain('class="md-code-block"')
    expect(html).toContain('<code class="language-bash">spool\nspool list -n 10\n</code>')
    expect(html).toContain('Run <code>spool</code> from the project.')
  })

  it('does not add copy chrome on surfaces that did not request it', () => {
    const html = renderToStaticMarkup(<Markdown>{'```text\nexample\n```'}</Markdown>)

    expect(html).not.toContain('aria-label="Copy code"')
    expect(html).not.toContain('md-code-block')
  })
})
