import { describe, it, expect } from 'vitest'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import de from './locales/de.json'
import fr from './locales/fr.json'

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

function flattenLeaves(tree: Tree, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
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

describe('locale key parity vs en.json', () => {
  it.each(LOCALES)('%s covers every translatable key in en.json', (name, tree) => {
    const present = leafPaths(tree)
    const missing = [...EN_PATHS].filter(p => !present.has(p))
    expect(missing, `${name} is missing keys present in en.json`).toEqual([])
  })

  it.each(LOCALES)('%s has no extra keys not declared in en.json', (name, tree) => {
    const present = leafPaths(tree)
    const extra = [...present].filter(p => !EN_PATHS.has(p))
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
      const hasOther = [...enFlat.keys()].some(p => p === `${base}_other`)
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
