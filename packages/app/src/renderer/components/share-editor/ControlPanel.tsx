import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  COLORWAYS,
  PAPERS,
  TEMPLATES,
  TYPEFACES,
  SENSITIVE_KIND_LABEL,
  SYNTHETIC_KIND_AUTHOR,
  SYNTHETIC_KIND_MANUAL,
  detectPII,
  hashValueForRedactExclude,
  type Conversation,
  type EditorOpts,
  type Paper,
  type Typeface,
  type SensitiveGroup,
  type SensitiveValue,
} from '@spool/share-kit'
import { TemplateThumb } from './TemplateThumb.js'
import { TurnSelector } from './TurnSelector.js'
import { useProgressiveCount } from './preview-progressive.js'

/** Tiny helper that updates the persisted opt-out lists. Both fields
 *  are kept sorted+deduped to keep diffs/autosave snapshots stable. */
function setRedactExclude(
  opts: EditorOpts,
  setOpts: (next: EditorOpts) => void,
  patch: { kinds?: string[]; valueHashes?: string[] },
) {
  const next = {
    kinds: dedupSorted(patch.kinds ?? opts.redactExclude?.kinds ?? []),
    valueHashes: dedupSorted(patch.valueHashes ?? opts.redactExclude?.valueHashes ?? []),
  }
  // If everything is empty, drop the field entirely so the serialised
  // snapshot doesn't carry an empty `{kinds:[], valueHashes:[]}`.
  if (next.kinds.length === 0 && next.valueHashes.length === 0) {
    const { redactExclude: _drop, ...rest } = opts
    setOpts(rest as EditorOpts)
    return
  }
  setOpts({ ...opts, redactExclude: next })
}

function dedupSorted(xs: string[]): string[] {
  return Array.from(new Set(xs)).sort()
}

function toggleInSet(xs: string[], v: string): string[] {
  const set = new Set(xs)
  if (set.has(v)) set.delete(v)
  else set.add(v)
  return Array.from(set)
}

type View = 'style' | 'messages' | 'privacy'

// share-kit's exported lists now match exactly what the app picker
// shows — Phase 0 trimmed the extras (transcript template, linen paper,
// bone colorway) once the picker stabilized on 4-of-each. If a future
// surface wants a broader range, expose new options in share-kit and
// pick a subset here again rather than maintaining parallel lists.

type Props = {
  convo: Conversation
  opts: EditorOpts
  setOpts: (next: EditorOpts) => void
}

export function ControlPanel({ convo, opts, setOpts }: Props) {
  const { t } = useTranslation()
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const [view, setView] = useState<View>('style')
  const currentColor = COLORWAYS.find((c) => c.id === opts.colorway) ?? COLORWAYS[0]!
  const currentPaper = PAPERS.find((p) => p.id === opts.paper) ?? PAPERS[0]!
  const currentTypeface = TYPEFACES.find((t) => t.id === opts.typeface) ?? TYPEFACES[0]!

  // Detection runs over every turn (not the selection) so the user
  // can spot leaks in turns they're about to include. The Body
  // renderer applies the final list per-turn at render time.
  //
  // Async (post-paint) rather than a render-time useMemo: the first
  // scan over a multi-thousand-turn session costs hundreds of ms, and
  // running it inside the editor's first commit stalled the open.
  // `null` = scan in flight; the Privacy tab shows a scanning hint and
  // the redact-off warning simply appears once the count is known.
  // Subsequent runs are near-free (share-kit caches detection per
  // Turn), so re-scans on conversation change don't flash the hint.
  const [pii, setPii] = useState<ReturnType<typeof detectPII> | null>(null)
  useEffect(() => {
    // The callback is fully synchronous, so clearTimeout alone is a
    // complete stale-set guard — no alive flag needed.
    const handle = window.setTimeout(() => setPii(detectPII(convo.turns)), 0)
    return () => window.clearTimeout(handle)
  }, [convo.turns])
  const totalRedactions = pii
    ? pii.groups.reduce((n, g) => n + g.count, 0) + pii.names.length
    : 0

  return (
    <div className="w-full h-full p-2 pt-0">
    <aside
      data-testid="share-editor-style-panel"
      className="w-full h-full bg-warm-bg dark:bg-dark-bg flex flex-col rounded-[10px] border border-warm-border dark:border-dark-border overflow-hidden"
    >
      <div className="flex-none px-3 pt-3 pb-2">
        <div
          role="tablist"
          aria-label={t('shareEditorPanel.panel_view')}
          className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-warm-surface dark:bg-dark-surface"
        >
          <ViewTab testId="share-editor-view-style" active={view === 'style'} onClick={() => setView('style')}>{t('shareEditorPanel.tab_style')}</ViewTab>
          <ViewTab testId="share-editor-view-messages" active={view === 'messages'} onClick={() => setView('messages')}>{t('shareEditorPanel.tab_messages')}</ViewTab>
          <ViewTab
            testId="share-editor-view-privacy"
            active={view === 'privacy'}
            onClick={() => setView('privacy')}
          >
            {t('shareEditorPanel.tab_privacy')}
          </ViewTab>
        </div>
      </div>
      {view === 'messages' ? (
        <TurnSelector convo={convo} opts={opts} setOpts={setOpts} />
      ) : view === 'privacy' ? (
        <PrivacyView opts={opts} setOpts={setOpts} pii={pii} totalRedactions={totalRedactions} />
      ) : (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[11px] font-medium tracking-[0.08em] text-warm-muted dark:text-dark-muted leading-none">
            {t('shareEditorPanel.section_template')}
          </div>
          <div className="text-[11px] text-warm-faint dark:text-dark-muted leading-none">
            {t('shareEditorPanel.section_template_count', { count: TEMPLATES.length })}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {TEMPLATES.map((tpl) => {
            const active = opts.template === tpl.id
            return (
              <button
                key={tpl.id}
                type="button"
                data-testid={`share-editor-template-${tpl.id}`}
                onClick={() => setOpts({ ...opts, template: tpl.id })}
                className={`flex items-center gap-2.5 text-left px-2.5 py-2 rounded-md border transition-colors focus:outline-none ${
                  active
                    ? 'border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                    : 'border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg hover:border-warm-faint/50 dark:hover:border-dark-muted/40'
                }`}
              >
                <TemplateThumb
                  id={tpl.id}
                  accent={opts.accentHex}
                  paper={currentPaper.tokens.paper}
                  border={currentPaper.tokens.border}
                  text={currentPaper.tokens.text}
                  muted={currentPaper.tokens.muted}
                  surface={currentPaper.tokens.surface}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-xs font-medium leading-tight ${
                      active ? 'text-accent dark:text-accent-dark' : 'text-warm-text dark:text-dark-text'
                    }`}
                  >
                    {tpl.name}
                  </div>
                  <div className="text-[10px] text-warm-muted dark:text-dark-muted font-mono leading-tight line-clamp-2">
                    {tpl.blurb}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <Section label={t('shareEditorPanel.section_paper')} hint={currentPaper.name}>
        <PaperPicker value={opts.paper} onChange={(p) => setOpts({ ...opts, paper: p })} />
      </Section>

      <Section label={t('shareEditorPanel.section_typeface')} hint={currentTypeface.name}>
        <TypefacePicker value={opts.typeface} onChange={(tf) => setOpts({ ...opts, typeface: tf })} />
      </Section>

      <Section label={t('shareEditorPanel.section_colorway')} hint={currentColor.name}>
        <div className="flex items-center gap-3">
          {COLORWAYS.map((c) => {
            const active = opts.colorway === c.id
            return (
              <button
                key={c.id}
                type="button"
                data-testid={`share-editor-colorway-${c.id}`}
                onClick={() => setOpts({ ...opts, colorway: c.id, accentHex: c.swatch })}
                title={c.name}
                aria-label={c.name}
                className="w-6 h-6 rounded-full p-0 focus:outline-none"
                style={{
                  background: c.swatch,
                  boxShadow: active
                    ? `inset 0 0 0 2px var(--color-warm-text), 0 0 0 2px var(--color-warm-surface), 0 0 0 4px ${c.swatch}`
                    : 'none',
                }}
              />
            )
          })}
        </div>
      </Section>


      <Collapsible
        label={t('shareEditorPanel.section_moreOptions')}
        open={advancedOpen}
        onToggle={() => setAdvancedOpen(!advancedOpen)}
      >
        <div className="flex items-center justify-between py-2">
          <span className="text-[12px] text-warm-text/85 dark:text-dark-text/85">{t('shareEditorPanel.section_density')}</span>
          <div className="flex gap-1">
            <Chip testId="share-editor-density-compact" active={opts.density === 'compact'} onClick={() => setOpts({ ...opts, density: 'compact' })}>
              {t('shareEditor.density_compact')}
            </Chip>
            <Chip testId="share-editor-density-relaxed" active={opts.density === 'relaxed'} onClick={() => setOpts({ ...opts, density: 'relaxed' })}>
              {t('shareEditor.density_relaxed')}
            </Chip>
          </div>
        </div>
        <Toggle
          testId="share-editor-toggle-hideEmptyTurns"
          label={t('shareEditorPanel.toggle_hideEmptyTurns')}
          sub={t('shareEditorPanel.toggle_hideEmptyTurns_sub')}
          value={opts.hideEmptyTurns}
          onChange={(v) => setOpts({ ...opts, hideEmptyTurns: v })}
        />
        <Toggle
          testId="share-editor-toggle-showGaps"
          label={t('shareEditorPanel.toggle_gapMarkers')}
          sub={t('shareEditorPanel.toggle_gapMarkers_sub')}
          value={opts.showGaps}
          onChange={(v) => setOpts({ ...opts, showGaps: v })}
        />
        <Toggle
          testId="share-editor-toggle-showMasthead"
          label={t('shareEditorPanel.toggle_masthead')}
          sub={t('shareEditorPanel.toggle_masthead_sub')}
          value={opts.showMasthead}
          onChange={(v) => setOpts({ ...opts, showMasthead: v })}
        />
        <Toggle
          testId="share-editor-toggle-showColophon"
          label={t('shareEditorPanel.toggle_colophon')}
          sub={t('shareEditorPanel.toggle_colophon_sub')}
          value={opts.showColophon}
          onChange={(v) => setOpts({ ...opts, showColophon: v })}
        />
      </Collapsible>
      </div>
      )}
    </aside>
    </div>
  )
}

// Categorised summary. Each row is collapsible: header shows a
// tri-state checkbox + label + count; expanding reveals every
// detected literal with its own checkbox. Clicking a checkbox
// flips its state. For high-stakes categories (credentials, JWTs,
// PEM blocks…) the dangerous direction (allow → publish) opens an
// inline `[Allow] [Cancel]` confirm bar under the row so the user
// sees exactly which value is about to leak before they confirm.
// The safe direction (re-redact) is always immediate.
function RedactSummary({
  groups,
  authorNames,
  manualValues,
  opts,
  setOpts,
}: {
  groups: SensitiveGroup[]
  authorNames: string[]
  manualValues: string[]
  opts: EditorOpts
  setOpts: (next: EditorOpts) => void
}) {
  const { t } = useTranslation()
  const excludedKinds = new Set(opts.redactExclude?.kinds ?? [])
  const excludedHashes = new Set(opts.redactExclude?.valueHashes ?? [])

  const isKindExcluded = (kind: string) => excludedKinds.has(kind)
  const isValueExcluded = (value: string) =>
    excludedHashes.has(hashValueForRedactExclude(value))

  const allowKind = (kind: string) =>
    setRedactExclude(opts, setOpts, {
      kinds: Array.from(new Set([...(opts.redactExclude?.kinds ?? []), kind])),
    })
  const reRedactKind = (kind: string, valuesInKind: string[]) => {
    // Drop the kind from the exclude list AND clear any per-item
    // exceptions that belong to this category — the user's intent
    // here is "everything in this category goes back to masked",
    // not "everything except the items I previously whitelisted".
    const hashesToClear = new Set(valuesInKind.map(hashValueForRedactExclude))
    setRedactExclude(opts, setOpts, {
      kinds: (opts.redactExclude?.kinds ?? []).filter((k) => k !== kind),
      valueHashes: (opts.redactExclude?.valueHashes ?? []).filter((h) => !hashesToClear.has(h)),
    })
  }
  const toggleValue = (value: string) =>
    setRedactExclude(opts, setOpts, {
      valueHashes: toggleInSet(
        opts.redactExclude?.valueHashes ?? [],
        hashValueForRedactExclude(value),
      ),
    })

  const hasAuto = groups.length > 0
  const hasAuthor = authorNames.length > 0
  const hasManual = manualValues.length > 0
  if (!hasAuto && !hasAuthor && !hasManual) {
    return (
      <div
        data-testid="share-editor-privacy-clean"
        className="mt-2 px-2.5 py-2 rounded-md bg-warm-surface/50 dark:bg-dark-surface/40 text-[11.5px] text-warm-muted dark:text-dark-muted leading-snug"
      >
        {t('shareEditorPanel.redact_noneSensitive')}
      </div>
    )
  }
  // Synthetic categories (author / manual) don't go through the
  // regex pipeline, so they don't carry occurrence counts. Wrap as
  // distinct entries with count 1 so the same RedactRow component
  // works for them.
  const authorValues: SensitiveValue[] = authorNames.map((value) => ({ value, count: 1 }))
  const manualEntries: SensitiveValue[] = manualValues.map((value) => ({ value, count: 1 }))

  return (
    <div data-testid="share-editor-privacy-summary" className="mt-2 flex flex-col gap-1">
      {groups.map((g) => (
        <RedactRow
          key={g.kind}
          kind={g.kind}
          label={SENSITIVE_KIND_LABEL[g.kind]}
          values={g.values}
          minConfidence={g.minConfidence}
          kindExcluded={isKindExcluded(g.kind)}
          onAllowAll={() => allowKind(g.kind)}
          onRedactAll={() => reRedactKind(g.kind, g.values.map((v) => v.value))}
          isValueExcluded={isValueExcluded}
          onToggleValue={toggleValue}
        />
      ))}
      {hasAuthor && (
        <RedactRow
          kind={SYNTHETIC_KIND_AUTHOR}
          label={t('shareEditorPanel.section_authorName')}
          values={authorValues}
          minConfidence={1}
          note={t('shareEditorPanel.section_authorName_fromTurns')}
          kindExcluded={isKindExcluded(SYNTHETIC_KIND_AUTHOR)}
          onAllowAll={() => allowKind(SYNTHETIC_KIND_AUTHOR)}
          onRedactAll={() => reRedactKind(SYNTHETIC_KIND_AUTHOR, authorNames)}
          isValueExcluded={isValueExcluded}
          onToggleValue={toggleValue}
        />
      )}
      {hasManual && (
        <RedactRow
          kind={SYNTHETIC_KIND_MANUAL}
          label={t('shareEditorPanel.section_manualEntry')}
          values={manualEntries}
          minConfidence={1}
          note={t('shareEditorPanel.section_manualEntry_note')}
          kindExcluded={isKindExcluded(SYNTHETIC_KIND_MANUAL)}
          onAllowAll={() => allowKind(SYNTHETIC_KIND_MANUAL)}
          onRedactAll={() => reRedactKind(SYNTHETIC_KIND_MANUAL, manualValues)}
          isValueExcluded={isValueExcluded}
          onToggleValue={toggleValue}
        />
      )}
    </div>
  )
}

function RedactRow({
  kind,
  label,
  values,
  minConfidence: _minConfidence,
  note,
  kindExcluded,
  onAllowAll,
  onRedactAll,
  isValueExcluded,
  onToggleValue,
}: {
  kind: string
  label: string
  values: SensitiveValue[]
  minConfidence: number
  note?: string
  kindExcluded: boolean
  onAllowAll: () => void
  onRedactAll: () => void
  isValueExcluded: (value: string) => boolean
  onToggleValue: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Expanded value rows mount progressively: a category like
  // absolute-path can carry thousands of distinct values, and mounting
  // them in one commit froze the panel on expand. Rows stream in over
  // a few frames; closing resets to zero via the total clamp.
  const shownValues = useProgressiveCount(open ? values.length : 0, 0, 400)
  // Header `×N` sums occurrences across duplicates so the user sees
  // how many times sensitive data appears in the source. The
  // expanded list still shows one row per distinct value.
  const totalOccurrences = values.reduce((n, v) => n + v.count, 0)
  const allowedDistinct = kindExcluded
    ? values.length
    : values.filter((v) => isValueExcluded(v.value)).length
  const bulkState: 'all' | 'mixed' | 'none' = kindExcluded
    ? 'none'
    : allowedDistinct === 0
      ? 'all'
      : 'mixed'

  const handleBulkClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (bulkState === 'all') onAllowAll()
    else onRedactAll()
  }

  const testId = `share-editor-privacy-row-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div
      data-testid={testId}
      className={`rounded-md transition-colors ${
        kindExcluded
          ? 'bg-accent-bg/20 dark:bg-accent-bg-dark/15 border border-accent/20 dark:border-accent-dark/20'
          : 'bg-warm-surface/50 dark:bg-dark-surface/40 border border-transparent'
      }`}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-1.5"
        data-testid={`${testId}-header`}
      >
        <BulkCheckbox
          state={bulkState}
          onClick={handleBulkClick}
          label={label}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left focus:outline-none"
        >
          <Chevron open={open} />
          <span className={`flex-1 min-w-0 text-[12px] truncate ${kindExcluded ? 'text-warm-faint dark:text-dark-muted line-through' : 'text-warm-text dark:text-dark-text'}`}>
            {label}
          </span>
          <span className="flex-none text-[10.5px] text-warm-faint dark:text-dark-muted font-mono tabular-nums">
            {totalOccurrences}
          </span>
        </button>
      </div>

      {open && (
        <div className="px-2.5 pb-2 pt-1 flex flex-col gap-0.5 border-t border-warm-border/40 dark:border-dark-border/40">
          {note && <div className="text-[10.5px] text-warm-faint dark:text-dark-muted py-1">{note}</div>}
          {values.slice(0, shownValues).map((v, i) => {
            const excluded = isValueExcluded(v.value) || kindExcluded
            const interactive = !kindExcluded
            return (
              <ValueRow
                key={i}
                kind={kind}
                value={v.value}
                occurrences={v.count}
                checked={!excluded}
                interactive={interactive}
                {...(interactive ? { onClick: () => onToggleValue(v.value) } : {})}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="flex-none text-warm-muted dark:text-dark-muted transition-transform"
      style={{ transform: open ? 'rotate(90deg)' : 'none' }}
    >
      <path d="M3.5 2L7 5L3.5 8" />
    </svg>
  )
}

// Tri-state checkbox encoding the bulk redact state for a category.
// `all` = every item will be masked (default, accent-filled box with
// check). `mixed` = some opted out (accent-filled box with horizontal
// bar). `none` = whole category opted out (empty box). Click cycles
// follow safe-direction logic in the parent — this component just
// renders the state and reports clicks.
function BulkCheckbox({
  state,
  onClick,
  label,
}: {
  state: 'all' | 'mixed' | 'none'
  onClick: (e: React.MouseEvent) => void
  label: string
}) {
  const { t } = useTranslation()
  const filled = state !== 'none'
  const title = state === 'none'
    ? t('shareEditorPanel.redact_redactAll', { label })
    : state === 'mixed'
      ? t('shareEditorPanel.redact_mixed', { label })
      : t('shareEditorPanel.redact_allowAll', { label })
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'all' ? true : state === 'none' ? false : 'mixed'}
      aria-label={title}
      title={title}
      onClick={onClick}
      data-testid={`share-editor-privacy-bulk-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={`flex-none w-[14px] h-[14px] inline-flex items-center justify-center rounded-[3px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${
        filled
          ? 'bg-accent dark:bg-accent-dark'
          : 'bg-transparent border border-warm-border dark:border-dark-border'
      }`}
    >
      {state === 'all' && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 5L4 7L8 3" />
        </svg>
      )}
      {state === 'mixed' && (
        <div className="w-[7px] h-[1.8px] bg-white rounded-[1px]" aria-hidden />
      )}
    </button>
  )
}

// One value row inside an expanded category. Standard two-state
// checkbox + monospace value text. Long values get end-truncated;
// the full string lives in the title attribute for hover. When the
// same literal occurred multiple times in the source, a small `×N`
// chip on the right communicates that one decision covers all N
// occurrences.
function ValueRow({
  kind,
  value,
  occurrences,
  checked,
  interactive,
  onClick,
}: {
  kind: string
  value: string
  occurrences: number
  checked: boolean
  interactive: boolean
  onClick?: () => void
}) {
  const { t } = useTranslation()
  const valueContent = (
    <>
      <ValueCheckbox checked={checked} interactive={interactive} />
      <span
        className={`flex-1 min-w-0 truncate text-[11px] font-mono ${
          checked
            ? 'text-warm-text dark:text-dark-text'
            : 'text-accent dark:text-accent-dark'
        }`}
      >
        {displayValue(value, kind)}
      </span>
      {occurrences > 1 && (
        <span
          title={t('shareEditorPanel.redact_appearsTimes_other', { count: occurrences })}
          className="flex-none text-[10px] text-warm-faint dark:text-dark-muted font-mono tabular-nums"
        >
          {occurrences}
        </span>
      )}
    </>
  )
  // Left padding `pl-5` aligns the checkbox under the parent
  // category's label (which sits ~20px past the bulk checkbox
  // edge), establishing a clear parent/child visual nest.
  if (!interactive) {
    return (
      <div
        title={value}
        className="px-1 py-1 rounded flex items-center gap-2 cursor-default"
      >
        {valueContent}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={value}
      className="px-1 py-1 rounded flex items-center gap-2 text-left transition-colors focus:outline-none hover:bg-warm-surface2/60 dark:hover:bg-dark-surface2/60"
    >
      {valueContent}
    </button>
  )
}

function ValueCheckbox({ checked, interactive }: { checked: boolean; interactive: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex-none w-[12px] h-[12px] inline-flex items-center justify-center rounded-[3px] ${
        checked
          ? interactive
            ? 'bg-accent dark:bg-accent-dark'
            : 'bg-accent/60 dark:bg-accent-dark/60'
          : 'bg-transparent border border-accent/60 dark:border-accent-dark/60'
      }`}
    >
      {checked && (
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 5L4 7L8 3" />
        </svg>
      )}
    </span>
  )
}

function displayValue(raw: string, kind?: string): string {
  // Flatten whitespace so multi-line matches (PEM blocks, INI
  // sections) collapse to a single row. Full original lives in the
  // title attribute regardless.
  const flat = raw.replace(/\s+/g, ' ').trim()
  const MAX = 56
  if (flat.length <= MAX) return flat
  // URL-shaped kinds carry distinguishing info at the END (host,
  // path) — preserve both ends with a middle ellipsis so two
  // different URLs don't render as visual duplicates.
  if (kind === 'url-creds' || kind === 'connection-string') {
    const head = flat.slice(0, 28)
    const tail = flat.slice(-16)
    return `${head}…${tail}`
  }
  return `${flat.slice(0, MAX - 1)}…`
}

function ViewTab({
  active,
  onClick,
  children,
  testId,
  badge,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  testId?: string
  /** Inline count chip — used by the Privacy tab to make
   *  detected-leak count visible without entering the view. */
  badge?: number
}) {
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      aria-selected={active}
      {...(testId ? { 'data-testid': testId } : {})}
      className={`h-6 px-2.5 rounded text-[11.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
        active
          ? 'bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text shadow-[0_1px_1px_rgba(0,0,0,0.2)]'
          : 'bg-transparent text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      <span>{children}</span>
      {badge !== undefined && (
        <span
          data-testid={testId ? `${testId}-badge` : undefined}
          className="text-[9.5px] font-semibold leading-none px-1.5 py-[3px] rounded-full bg-accent-bg dark:bg-accent-bg-dark text-accent dark:text-accent-dark"
        >
          {badge}
        </span>
      )}
    </button>
  )
}

// Standalone Privacy view — peer of Style and Messages tabs. Pulled
// out of the Style scroll surface so high-stakes safety controls
// aren't fighting for space with aesthetic options, and so the tab
// itself can carry a count badge for at-a-glance leak visibility.
function PrivacyView({
  opts,
  setOpts,
  pii,
  totalRedactions,
}: {
  opts: EditorOpts
  setOpts: (next: EditorOpts) => void
  /** `null` while the initial detection scan is still running. */
  pii: ReturnType<typeof detectPII> | null
  totalRedactions: number
}) {
  const { t } = useTranslation()
  // How many sensitive occurrences would be VISIBLE in the shared
  // / exported artifact under the current policy. Drives both the
  // header count line and decides whether to show the Reset button.
  // While the initial scan is in flight (`pii === null`) the header —
  // including the master redact toggle, a safety control that must
  // never disappear — still renders; only the counts and the category
  // list wait for the scan.
  const excludedKinds = new Set(opts.redactExclude?.kinds ?? [])
  const excludedHashes = new Set(opts.redactExclude?.valueHashes ?? [])
  const isValueAllowed = (v: string) =>
    excludedHashes.size > 0 && excludedHashes.has(hashValueForRedactExclude(v))
  let visibleOccurrences = 0
  if (opts.redact && pii) {
    for (const g of pii.groups) {
      const kindIsAllowed = excludedKinds.has(g.kind)
      for (const v of g.values) {
        if (kindIsAllowed || isValueAllowed(v.value)) visibleOccurrences += v.count
      }
    }
    if (excludedKinds.has(SYNTHETIC_KIND_AUTHOR)) visibleOccurrences += pii.names.length
    else visibleOccurrences += pii.names.filter((n) => isValueAllowed(n)).length
    if (excludedKinds.has(SYNTHETIC_KIND_MANUAL)) visibleOccurrences += pii.manual.length
    else visibleOccurrences += pii.manual.filter((v) => isValueAllowed(v)).length
  } else {
    visibleOccurrences = totalRedactions
  }
  const hasAnyExclusion =
    (opts.redactExclude?.kinds?.length ?? 0) > 0 ||
    (opts.redactExclude?.valueHashes?.length ?? 0) > 0
  const handleReset = () => {
    const { redactExclude: _drop, ...rest } = opts
    setOpts(rest as EditorOpts)
  }

  // Headline only the actionable side. Total/masked counts are
  // implied by the master toggle being on + the list below; the
  // user really wants to know "what will leak?" — so only the
  // visible count carries the warning weight.
  let countLabel: string
  if (!pii) countLabel = t('shareEditorPanel.privacy_scanning')
  else if (totalRedactions === 0) countLabel = t('shareEditorPanel.redact_noneDetected')
  else if (!opts.redact) countLabel = t('shareEditorPanel.redact_willBeVisible', { count: totalRedactions })
  else if (visibleOccurrences === 0) countLabel = t('shareEditorPanel.redact_items_other', { count: totalRedactions })
  else countLabel = t('shareEditorPanel.redact_visible', { count: visibleOccurrences })

  return (
    <div
      data-testid="share-editor-privacy-panel"
      className="flex-1 min-h-0 flex flex-col"
    >
      {/* Fixed header — REDACTIONS / count / Reset + master toggle.
       *  Stays put when the category list scrolls below so the user
       *  always has the master control + leak-count in view. */}
      <div className="flex-none px-4 pt-3">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="text-[11px] font-medium tracking-[0.08em] text-warm-muted dark:text-dark-muted leading-none">
            {t('shareEditorPanel.section_redactions')}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div
              data-testid="share-editor-privacy-count"
              className={`flex-none text-[11px] leading-none ${
                opts.redact && visibleOccurrences > 0
                  ? 'text-accent dark:text-accent-dark'
                  : 'text-warm-faint dark:text-dark-muted'
              }`}
            >
              {countLabel}
            </div>
            {hasAnyExclusion && (
              <button
                type="button"
                onClick={handleReset}
                aria-label={t('shareEditorPanel.redact_resetAll_aria')}
                data-testid="share-editor-privacy-reset"
                title={t('shareEditorPanel.redact_resetAll')}
                className="flex-none w-4 h-4 inline-flex items-center justify-center rounded text-warm-faint/70 dark:text-dark-muted/70 hover:text-accent dark:hover:text-accent-dark hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors focus:outline-none"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 5.5A3.5 3.5 0 1 1 3 8" />
                  <path d="M1 3v2.5h2.5" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <Toggle
          testId="share-editor-toggle-redact"
          label={t('shareEditorPanel.redact_toggleLabel')}
          value={opts.redact}
          onChange={(v) => setOpts({ ...opts, redact: v })}
        />
        {!opts.redact && totalRedactions > 0 && (
          <div
            data-testid="share-editor-privacy-warning"
            className="mt-3 mb-4 px-3 py-2.5 rounded-md border leading-snug"
            style={{ borderColor: `${opts.accentHex}4D`, background: `${opts.accentHex}1A` }}
          >
            <div
              className="text-[11.5px] font-medium"
              style={{ color: opts.accentHex }}
            >
              {t('shareEditorPanel.redact_warning_other', { count: totalRedactions })}
            </div>
            <div className="mt-0.5 text-[11px] text-warm-muted dark:text-dark-muted">
              {t('shareEditorPanel.redact_warning_subtitle')}
            </div>
          </div>
        )}
      </div>
      {/* Only the categorised list scrolls. Header + master toggle
       *  stay pinned above. */}
      {opts.redact && (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none px-4 pb-4">
          {pii ? (
            <RedactSummary
              groups={pii.groups}
              authorNames={pii.names}
              manualValues={pii.manual}
              opts={opts}
              setOpts={setOpts}
            />
          ) : (
            <div className="py-6 text-center text-[11px] text-warm-faint dark:text-dark-muted">
              {t('shareEditorPanel.privacy_scanning')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-1.5 pb-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[11px] font-medium tracking-[0.08em] text-warm-muted dark:text-dark-muted leading-none">
          {label}
        </div>
        {hint && <div className="text-[11px] text-warm-faint dark:text-dark-muted leading-none">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Collapsible({
  label,
  open,
  onToggle,
  hint,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-4 pt-2 pb-3.5 flex items-center justify-between hover:bg-warm-surface2/60 dark:hover:bg-dark-surface2/60 transition-colors"
      >
        <span className="text-[11px] font-medium tracking-[0.08em] text-warm-muted dark:text-dark-muted">
          {label}
        </span>
        <span className="flex items-center gap-2.5">
          {hint && <span className="text-[10px] font-mono">{hint}</span>}
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-warm-muted dark:text-dark-muted transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          >
            <path d="M2 4l3.5 3.5L9 4" />
          </svg>
        </span>
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  )
}

function Toggle({
  label,
  sub,
  value,
  onChange,
  testId,
}: {
  label: string
  sub?: string
  value: boolean
  onChange: (next: boolean) => void
  testId?: string
}) {
  return (
    <div className="flex items-center justify-between py-2 gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-warm-text/85 dark:text-dark-text/85">{label}</div>
        {sub && <div className="text-[11px] text-warm-faint dark:text-dark-muted mt-0.5">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        {...(testId ? { 'data-testid': testId } : {})}
        className={`relative flex-none w-8 h-[18px] rounded-full transition-colors focus:outline-none ${
          value ? 'bg-accent dark:bg-accent-dark' : 'bg-warm-border dark:bg-dark-border'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-[2px] block w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all ${
            value ? 'left-[16px]' : 'left-[2px]'
          }`}
        />
      </button>
    </div>
  )
}

function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(testId ? { 'data-testid': testId } : {})}
      className={`px-2 py-0.5 rounded text-[11.5px] border transition-colors focus:outline-none ${
        active
          ? 'bg-accent-bg dark:bg-accent-bg-dark border-accent dark:border-accent-dark text-accent dark:text-accent-dark font-medium'
          : 'border-transparent text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      {children}
    </button>
  )
}


function TypefacePicker({ value, onChange }: { value: Typeface; onChange: (next: Typeface) => void }) {
  return (
    <div className="flex gap-2.5">
      {TYPEFACES.map((tf) => {
        const active = tf.id === value
        return (
          <button
            key={tf.id}
            type="button"
            data-testid={`share-editor-typeface-${tf.id}`}
            onClick={() => onChange(tf.id)}
            title={tf.name}
            aria-label={tf.name}
            className={`w-11 h-8 rounded-md flex items-center justify-center transition-colors focus:outline-none border ${
              active
                ? 'bg-accent-bg dark:bg-accent-bg-dark border-accent dark:border-accent-dark'
                : 'bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border hover:border-warm-faint/50 dark:hover:border-dark-muted/50'
            }`}
          >
            <span
              className={`text-[12px] font-semibold leading-none ${
                active ? 'text-accent dark:text-accent-dark' : 'text-warm-text/85 dark:text-dark-text/85'
              }`}
              style={{ fontFamily: tf.family, letterSpacing: '-0.02em' }}
            >
              {tf.sample}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PaperPicker({ value, onChange }: { value: Paper; onChange: (next: Paper) => void }) {
  return (
    <div className="flex gap-2.5">
      {PAPERS.map((p) => {
        const active = p.id === value
        return (
          <button
            key={p.id}
            type="button"
            data-testid={`share-editor-paper-${p.id}`}
            onClick={() => onChange(p.id)}
            title={p.name}
            aria-label={p.name}
            className="w-11 h-8 rounded-md flex items-center justify-center p-0 focus:outline-none"
            style={{
              background: p.tokens.paper,
              boxShadow: active
                ? `0 0 0 2px var(--color-warm-surface), 0 0 0 3px var(--color-accent)`
                : `inset 0 0 0 1px ${p.tokens.border}`,
            }}
          >
            <span
              className="text-[12px] font-semibold pointer-events-none"
              style={{ color: p.tokens.text, letterSpacing: '-0.02em' }}
            >
              Aa
            </span>
          </button>
        )
      })}
    </div>
  )
}
