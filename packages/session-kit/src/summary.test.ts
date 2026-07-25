import { describe, expect, it } from 'vite-plus/test'

import { costForUsage } from './pricing.js'
import { parseSummaryFrontMatter } from './summary.js'

describe('parseSummaryFrontMatter', () => {
  it('parses bilingual titles and strips the block from the body', () => {
    const parsed = parseSummaryFrontMatter(
      '---\ntitle: Fix daemon reconnect loop after macOS sleep/wake\ntitle_zh: 修复 macOS 休眠唤醒后 daemon 重连死循环\n---\n\n# Fix daemon reconnect loop\n\n## Goal\nStop the loop.',
    )

    expect(parsed.titles).toEqual({
      en: 'Fix daemon reconnect loop after macOS sleep/wake',
      zh: '修复 macOS 休眠唤醒后 daemon 重连死循环',
    })
    expect(parsed.body.startsWith('# Fix daemon reconnect loop')).toBe(true)
    expect(parsed.body).not.toContain('---')
    expect(parsed.summaries).toBeNull()
  })

  it('parses bilingual Markdown bodies and keeps English as the compatibility body', () => {
    const parsed = parseSummaryFrontMatter(
      [
        '---',
        'title: Explain React Vapor and build the compiler runtime',
        'title_zh: 解释 React Vapor 并构建编译器运行时',
        '---',
        '',
        '<!-- spool:summary:en -->',
        '# Build React Vapor support',
        '',
        'React Vapor reduces runtime reconciliation work.',
        '<!-- /spool:summary -->',
        '',
        '<!-- spool:summary:zh -->',
        '# 构建 React Vapor 支持',
        '',
        'React Vapor 通过编译降低运行时协调开销。',
        '<!-- /spool:summary -->',
      ].join('\n'),
    )

    expect(parsed.summaries).toEqual({
      en: '# Build React Vapor support\n\nReact Vapor reduces runtime reconciliation work.',
      zh: '# 构建 React Vapor 支持\n\nReact Vapor 通过编译降低运行时协调开销。',
    })
    expect(parsed.body).toBe(parsed.summaries?.en)
  })

  it('treats summaries without a leading block as plain bodies', () => {
    for (const source of [
      '# Just a heading\n\nBody.',
      'Text first\n---\ntitle: not front-matter\n---',
      '---\ntitle: never closed',
      '',
    ]) {
      const parsed = parseSummaryFrontMatter(source)
      expect(parsed.titles).toBeNull()
      expect(parsed.summaries).toBeNull()
      expect(parsed.body).toBe(source)
    }
    expect(parseSummaryFrontMatter(null)).toEqual({
      titles: null,
      summaries: null,
      body: '',
      titleOverflow: false,
    })
  })

  it('ignores unknown keys, unquotes, and single-lines title values', () => {
    const parsed = parseSummaryFrontMatter(
      '---\r\ntitle: "Ship the  thing"\r\nauthor: someone\r\ntitle_zh:   完成任务  \r\n---\r\nBody',
    )
    expect(parsed.titles).toEqual({ en: 'Ship the thing', zh: '完成任务' })
    expect(parsed.summaries).toBeNull()
    expect(parsed.body).toBe('Body')
  })

  it('bounds stored titles to the 96-character design contract', () => {
    const parsed = parseSummaryFrontMatter(`---\ntitle: ${'a'.repeat(120)}\n---\nBody`)
    expect(parsed.titles?.en).toBe('a'.repeat(96))
    expect(parsed.titleOverflow).toBe(true)
  })

  it('does not apply title limits to ignored front-matter keys', () => {
    const parsed = parseSummaryFrontMatter(
      `---\nauthor: ${'a'.repeat(120)}\ntitle: Short outcome\n---\nBody`,
    )
    expect(parsed.titles?.en).toBe('Short outcome')
    expect(parsed.titleOverflow).toBe(false)
  })

  it('yields null titles when the block has no usable title keys', () => {
    const parsed = parseSummaryFrontMatter('---\nauthor: x\n---\nBody')
    expect(parsed.titles).toBeNull()
    expect(parsed.summaries).toBeNull()
    expect(parsed.body).toBe('Body')
  })

  it('falls back to the full body when localized delimiters are malformed', () => {
    const source =
      '<!-- spool:summary:en -->\nEnglish without an end\n<!-- spool:summary:zh -->\n中文'
    const parsed = parseSummaryFrontMatter(source)
    expect(parsed.summaries).toBeNull()
    expect(parsed.body).toBe(source)
  })
})

describe('costForUsage', () => {
  it('prices by longest model prefix and reports totals', () => {
    const cost = costForUsage({
      models: {
        // 1M of each bucket on sonnet-4 = 3 + 15 + 0.3 + 3.75 = 22.05
        'claude-sonnet-4-5-20250929': {
          input: 1_000_000,
          output: 1_000_000,
          cacheRead: 1_000_000,
          cacheWrite: 1_000_000,
        },
        'gpt-5-codex-preview': { input: 2_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      records: 3,
    })

    expect(cost).not.toBeNull()
    expect(cost!.usd).toBeCloseTo(22.05 + 2.5, 4)
    expect(cost!.totalTokens).toBe(6_000_000)
    expect(cost!.unpricedModels).toEqual([])
  })

  it('keeps unpriced models in the token total without claiming a dollar amount', () => {
    const cost = costForUsage({
      models: {
        'mystery-model-x': { input: 500, output: 100, cacheRead: 0, cacheWrite: 0 },
      },
      records: 1,
    })
    expect(cost).toEqual({ usd: null, totalTokens: 600, unpricedModels: ['mystery-model-x'] })
  })

  it('uses current longest-prefix snapshots for Claude and GPT families', () => {
    const cost = costForUsage({
      models: {
        'claude-opus-4-8-20260720': {
          input: 1_000_000,
          output: 1_000_000,
          cacheRead: 0,
          cacheWrite: 0,
        },
        'gpt-5.6-terra': {
          input: 1_000_000,
          output: 1_000_000,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
      records: 2,
    })
    expect(cost?.usd).toBe(47.5)
  })

  it('rejects fractional or overflowing token totals', () => {
    expect(
      costForUsage({
        models: {
          'gpt-5': { input: 0.5, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
        records: 1,
      }),
    ).toBeNull()
    expect(
      costForUsage({
        models: {
          'gpt-5': {
            input: Number.MAX_SAFE_INTEGER,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
        records: 1,
      }),
    ).toBeNull()
  })

  it('returns null without usage or tokens', () => {
    expect(costForUsage(null)).toBeNull()
    expect(costForUsage(undefined)).toBeNull()
    expect(costForUsage({ models: {}, records: 0 })).toBeNull()
    expect(
      costForUsage({
        models: { 'claude-sonnet-4': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        records: 1,
      }),
    ).toBeNull()
  })
})
