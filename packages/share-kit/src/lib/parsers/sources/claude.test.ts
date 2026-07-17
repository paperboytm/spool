import { describe, expect, it } from 'vitest'
import { claudeSource } from './claude'

const URL = 'https://claude.ai/share/11111111-2222-3333-4444-555555555555'

describe('claudeSource — sr-only HTML fallback tag stripping', () => {
  it('leaves no "<script" substring when the sr-only heading carries a nested-tag payload', () => {
    // Jina's markdown pipeline sometimes drops the role headings entirely,
    // forcing the sr-only HTML fallback (splitByHtmlHeadings) to supply the
    // turn body straight from the page's raw HTML — untrusted third-party
    // content. Regression for js/incomplete-multi-character-sanitization and
    // js/polynomial-redos on the old single-pass `stripTags`.
    const markdown = 'This is a copy of a chat between Claude and a user.'
    const html = '<h2 class="sr-only">You said: <<script>script>alert(1)</script></h2>'

    const conversation = claudeSource.extract({ markdown, html, title: 'Claude', url: URL })

    expect(conversation.turns).toHaveLength(1)
    expect(conversation.turns[0]?.body).not.toContain('<script')
    expect(conversation.title).not.toContain('<script')
  })

  it('does not hang when the sr-only heading contains a long run of unterminated "<" characters (ReDoS probe)', () => {
    // The old `/<[^>]+>/g` in stripTags backtracks polynomially when the
    // `[^>]+` run never finds a closing `>` (measured multi-second hangs at
    // 100k chars on the pre-fix regex vs. sub-millisecond here). There's no
    // `>` anywhere in this payload, so — same as the documented
    // unterminated-block behavior elsewhere in the codebase — the run
    // survives verbatim; the point of this test is that it returns fast,
    // not that it's sanitized.
    const markdown = 'This is a copy of a chat between Claude and a user.'
    const hostile = '<'.repeat(100_000)
    const html = `<h2 class="sr-only">You said: ${hostile}</h2>`

    const start = Date.now()
    const conversation = claudeSource.extract({ markdown, html, title: 'Claude', url: URL })
    const elapsedMs = Date.now() - start

    expect(elapsedMs).toBeLessThan(2_000)
    expect(conversation.turns).toHaveLength(1)
  })
})
