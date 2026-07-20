import { describe, it, expect } from 'vite-plus/test'

import de from './locales/de.json'
import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

type Tree = Record<string, unknown>

const NO_PLURAL_LOCALES = new Set(['zh-CN', 'zh-TW', 'ja', 'ko'])
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/**
 * Walk a translation tree and return the set of leaf paths with the
 * trailing plural suffix stripped. en.json's singular form may be
 * spelled as either `key` or `key_one`; both reduce to `key` so the
 * comparison ignores that convention difference across locales.
 */
function leafPaths(tree: Tree, prefix = ''): Set<string> {
  const out = new Set<string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const child of leafPaths(value as Tree, path)) out.add(child)
    } else {
      out.add(path.replace(PLURAL_SUFFIX, ''))
    }
  }
  return out
}

function flattenLeaves(
  tree: Tree,
  prefix = '',
  out = new Map<string, unknown>(),
): Map<string, unknown> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenLeaves(value as Tree, path, out)
    } else {
      out.set(path, value)
    }
  }
  return out
}

const LOCALES: Array<[string, Tree]> = [
  ['zh-CN', zhCN as Tree],
  ['zh-TW', zhTW as Tree],
  ['ja', ja as Tree],
  ['ko', ko as Tree],
  ['de', de as Tree],
  ['fr', fr as Tree],
]

const EN_PATHS = leafPaths(en as Tree)

interface HubShareCopy {
  title: string
  lead: string
  publish: string
  publishing: string
  doneTitle: string
  doneLead: string
  linkOnlyTitle: string
  linkOnlyLead: string
  linkOnlyPublish: string
  linkOnlyPublishing: string
  linkOnlyDoneTitle: string
  linkOnlyDoneLead: string
}

const HUB_SHARE_COPY: Array<
  [
    locale: string,
    copy: HubShareCopy,
    terms: {
      public: string
      linkOnly: string
      sourceUnchanged: string
      publishAction: string
      shareAction: string
    },
  ]
> = [
  [
    'en',
    en.hubShare,
    {
      public: 'Public',
      linkOnly: 'Link-only',
      sourceUnchanged: 'source Session stays unchanged',
      publishAction: 'Publish Session',
      shareAction: 'Share link',
    },
  ],
  [
    'de',
    de.hubShare,
    {
      public: 'Public',
      linkOnly: 'nur per Link',
      sourceUnchanged: 'Quell-Session bleibt unverändert',
      publishAction: 'Session veröffentlichen',
      shareAction: 'Link teilen',
    },
  ],
  [
    'fr',
    fr.hubShare,
    {
      public: 'publique',
      linkOnly: 'accessible par lien',
      sourceUnchanged: 'Session source reste inchangée',
      publishAction: 'Publier la Session',
      shareAction: 'Partager le lien',
    },
  ],
  [
    'ja',
    ja.hubShare,
    {
      public: '公開',
      linkOnly: 'リンク限定',
      sourceUnchanged: '元のセッションは変更されません',
      publishAction: 'セッションを公開',
      shareAction: 'リンクを共有',
    },
  ],
  [
    'ko',
    ko.hubShare,
    {
      public: '공개',
      linkOnly: '링크 전용',
      sourceUnchanged: '원본 세션은 변경되지 않습니다',
      publishAction: '세션 게시',
      shareAction: '링크 공유',
    },
  ],
  [
    'zh-CN',
    zhCN.hubShare,
    {
      public: '公开',
      linkOnly: '仅链接',
      sourceUnchanged: '源会话不会被更改',
      publishAction: '发布会话',
      shareAction: '分享链接',
    },
  ],
  [
    'zh-TW',
    zhTW.hubShare,
    {
      public: '公開',
      linkOnly: '僅連結',
      sourceUnchanged: '來源會話不會被變更',
      publishAction: '發佈會話',
      shareAction: '分享連結',
    },
  ],
]

describe('locale key parity vs en.json', () => {
  it.each(LOCALES)('%s covers every translatable key in en.json', (name, tree) => {
    const present = leafPaths(tree)
    const missing = [...EN_PATHS].filter((p) => !present.has(p))
    expect(missing, `${name} is missing keys present in en.json`).toEqual([])
  })

  it.each(LOCALES)('%s has no extra keys not declared in en.json', (name, tree) => {
    const present = leafPaths(tree)
    const extra = [...present].filter((p) => !EN_PATHS.has(p))
    expect(extra, `${name} has keys that en.json does not`).toEqual([])
  })

  // Snapshot of en.json keys that interpolate {{count}} but never
  // wired up a _other plural sibling. Most are intentional (short
  // suffix strings like "{{count}}m" / "{{count}}h" where the unit
  // never inflects); others are pre-existing tech debt. New unpluralised
  // {{count}} keys MUST NOT be added — the assertion below pins this
  // list to its current shape so any addition surfaces in review.
  const KNOWN_NO_OTHER: ReadonlyArray<string> = [
    'settings.sources_count_claude',
    'settings.sources_count_codex',
    'settings.sources_count_gemini',
    'settings.sources_count_opencode',
    'shares.minutesAgo',
    'shares.hoursAgo',
    'shares.daysAgo',
    'status.indexing',
    'status.indexing_short',
    'status.minutesAgo',
    'status.hoursAgo',
    'status.daysAgo',
    'shareEditorPanel.section_template_count',
    'shareEditorPanel.redact_willBeVisible',
    'shareEditorPanel.redact_visible',
    // `{{count}} info` — short noun, never inflects in any locale
    // we ship; pluralising would just add noise. Lives next to the
    // pluralised `summary` ("X risk · Y sessions") that DOES have
    // separate one/other forms in some languages.
    'security.summary_info',
    // Aria label combines {{count}} with {{kind}} + {{sessions}} —
    // not a count-driven phrase, the number is just one of three
    // interpolated values. Inflecting would require dropping the
    // multi-arg form.
    'security.chip_aria',
    // Backups manager — {{count}} is shown as a bare number inside
    // chip labels / age-suffix strings / result lines. None of the
    // surrounding words inflect in the locales we ship; pluralising
    // would just add noise.
    'settings.security.backups_summary',
    'settings.security.backups_select_auto',
    'settings.security.backups_age_min',
    'settings.security.backups_age_hr',
    'settings.security.backups_age_day',
    'settings.security.backups_age_mo',
    'settings.security.backups_delete_result',
    'settings.security.backups_header_selected_size',
  ]

  it('every {{count}} interpolation in en.json either has _other or is in the allow-list snapshot', () => {
    const enFlat = flattenLeaves(en as Tree)
    const missing: string[] = []
    for (const [path, value] of enFlat) {
      if (typeof value !== 'string') continue
      if (!value.includes('{{count}}')) continue
      const base = path.replace(PLURAL_SUFFIX, '')
      const hasOther = [...enFlat.keys()].some((p) => p === `${base}_other`)
      if (!hasOther) missing.push(base)
    }
    // Sort both sides so the diff is stable and easy to triage.
    expect([...new Set(missing)].sort()).toEqual([...KNOWN_NO_OTHER].sort())
  })

  it.each(LOCALES.filter(([n]) => NO_PLURAL_LOCALES.has(n)))(
    '%s uses only _other for plural keys (no _one needed)',
    (_name, tree) => {
      const offenders: string[] = []
      for (const path of flattenLeaves(tree).keys()) {
        if (/_one$/.test(path)) offenders.push(path)
      }
      expect(offenders).toEqual([])
    },
  )
})

describe('Hub Share visibility copy', () => {
  it.each(HUB_SHARE_COPY)(
    '%s makes supported Sessions Public and keeps unsupported providers Link-only',
    (_locale, copy, terms) => {
      expect(copy.lead).toContain('{{records}}')
      expect(copy.lead).toContain(terms.public)
      expect(copy.lead).toContain('Explore')
      expect(copy.lead).toContain(terms.sourceUnchanged)
      expect(copy.publish).toBe(terms.publishAction)
      expect(copy.doneLead).toContain(terms.public)
      expect(copy.doneLead).toContain('Explore')
      expect(copy.doneLead).toContain(terms.sourceUnchanged)

      expect(copy.linkOnlyPublish).toBe(terms.shareAction)
      for (const message of [copy.linkOnlyTitle, copy.linkOnlyLead, copy.linkOnlyDoneLead]) {
        expect(message).toContain(terms.linkOnly)
      }
      for (const message of [copy.linkOnlyLead, copy.linkOnlyDoneLead]) {
        expect(message).toContain('Explore')
        expect(message).toContain(terms.sourceUnchanged)
      }
    },
  )
})
