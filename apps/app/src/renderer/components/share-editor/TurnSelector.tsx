import { forwardRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type Components } from 'react-virtuoso'
import { Check, CheckCheck, Eraser } from 'lucide-react'
import type { Conversation, EditorOpts } from '@spool/share-kit'

// Restore the list semantics + breathing room the old <ul>/<li> markup
// carried: Virtuoso renders bare divs by default, which drops the
// screen-reader list context and the py-1 inset around the rows.
const virtuosoComponents: Components<{ turn: { body: string }; originalIndex: number }> = {
  List: forwardRef(function TurnList(props, ref) {
    return <div role="list" {...props} ref={ref} className="py-1" />
  }),
  Item: function TurnItem(props) {
    return <div role="listitem" {...props} />
  },
}

type Props = {
  convo: Conversation
  opts: EditorOpts
  setOpts: (opts: EditorOpts) => void
}

/**
 * Embedded messages view for the right ControlPanel — header + scrolling
 * list of turns + Select all / Clear footer. The chrome (chip, popover,
 * dismissal) lives in the panel's view switcher; this component just
 * draws the picker itself.
 *
 * Canonical write rule: when every turn is included, write
 * `selected: undefined` (not a fully-populated array) so the downstream
 * `isExcerpt` flag flips back to false.
 */
export function TurnSelector({ convo, opts, setOpts }: Props) {
  const { t } = useTranslation()
  const total = convo.turns.length

  const selectedSet = useMemo(() => {
    if (opts.selected === undefined) return null
    return new Set(opts.selected)
  }, [opts.selected])

  // Mirror what the preview renders. When `hideEmptyTurns` is on, empty
  // turns are skipped here too — indices stay as the original turn
  // positions in `convo.turns`, so the displayed list may show 01 / 03 /
  // 07 with gaps. The selected[] we write back still references the
  // original array.
  const visibleTurns = useMemo(() => {
    const rows = convo.turns.map((turn, i) => ({ turn, originalIndex: i }))
    if (!opts.hideEmptyTurns) return rows
    return rows.filter(({ turn }) => turn.body.trim() !== '')
  }, [convo.turns, opts.hideEmptyTurns])

  // The displayed list filters out empty turns when `hideEmptyTurns`
  // is on. The header counts must reflect what the user actually sees
  // in the panel — otherwise "526 of 526" looks wrong next to a
  // scrolled list of ~150 visible rows.
  const visibleTotal = visibleTurns.length
  const visibleKept = selectedSet === null
    ? visibleTotal
    : visibleTurns.filter(({ originalIndex }) => selectedSet.has(originalIndex)).length

  const writeSelection = useCallback(
    (next: number[]) => {
      const fullyIncluded = next.length === total
      setOpts({ ...opts, selected: fullyIncluded ? undefined : next })
    },
    [opts, setOpts, total],
  )

  const toggleTurn = useCallback(
    (index: number) => {
      const current =
        opts.selected === undefined
          ? Array.from({ length: total }, (_, i) => i)
          : [...opts.selected]
      const at = current.indexOf(index)
      if (at >= 0) current.splice(at, 1)
      else current.push(index)
      current.sort((a, b) => a - b)
      writeSelection(current)
    },
    [opts.selected, total, writeSelection],
  )

  const selectAll = useCallback(() => {
    setOpts({ ...opts, selected: undefined })
  }, [opts, setOpts])

  const clearAll = useCallback(() => {
    setOpts({ ...opts, selected: [] })
  }, [opts, setOpts])

  const jumpToTurn = useCallback((index: number) => {
    // The preview mounts large documents progressively, so a turn deep
    // in the conversation may not be in the DOM yet right after the
    // editor opens. Retry across frames (bounded) until the fill
    // reaches it instead of silently doing nothing.
    const tryJump = (attempt: number) => {
      const el = document.querySelector<HTMLElement>(`[data-turn-index="${index}"]`)
      if (!el) {
        if (attempt < 120) requestAnimationFrame(() => tryJump(attempt + 1))
        return
      }
      // Compute scrollTop manually instead of `scrollIntoView` so we
      // only touch the vertical axis. scrollIntoView walks up the DOM
      // and (under zoom transform) ends up shifting the artifact card
      // horizontally off-center too.
      const sc = el.closest<HTMLElement>('[data-share-preview-scroll]')
      if (sc) {
        const turnRect = el.getBoundingClientRect()
        const scRect = sc.getBoundingClientRect()
        const offsetFromContainerTop = (turnRect.top - scRect.top) + sc.scrollTop
        const centered = offsetFromContainerTop - (scRect.height - turnRect.height) / 2
        sc.scrollTop = Math.max(0, centered)
      } else {
        // Fallback for anything not inside our preview pane.
        el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
      }
      // Brief flash so the user sees where they landed. Remove + force
      // reflow + re-add so the animation restarts on repeated clicks.
      el.removeAttribute('data-spool-share-flash')
      void el.offsetWidth
      el.setAttribute('data-spool-share-flash', '')
      window.setTimeout(() => el.removeAttribute('data-spool-share-flash'), 1700)
    }
    tryJump(0)
  }, [])

  if (total === 0) {
    return (
      <div className="px-4 py-6 text-center text-[11px] text-warm-faint dark:text-dark-muted">
        {t('shareEditorPanel.turnSelector_empty')}
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-[10px] tracking-wider font-medium text-warm-faint dark:text-dark-faint">
          {t('shareEditorPanel.turnSelector_header', { kept: visibleKept, total: visibleTotal })}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            data-testid="share-editor-turns-select-all"
            onClick={selectAll}
            title={t('shareEditorPanel.turnSelector_selectAll')}
            aria-label={t('shareEditorPanel.turnSelector_selectAll')}
            className="w-5 h-5 inline-flex items-center justify-center rounded text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
          >
            <CheckCheck size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            data-testid="share-editor-turns-clear"
            onClick={clearAll}
            title={t('shareEditorPanel.turnSelector_deselectAll')}
            aria-label={t('shareEditorPanel.turnSelector_deselectAll')}
            className="w-5 h-5 inline-flex items-center justify-center rounded text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
          >
            <Eraser size={12} strokeWidth={1.75} />
          </button>
        </span>
      </div>
      {/* Virtualised: a session can carry thousands of turns and the
          panel used to mount one row per turn in a single synchronous
          commit — switching to this tab froze the editor for seconds.
          Same react-virtuoso setup as SessionDetail's MessageList. */}
      <Virtuoso
        data={visibleTurns}
        computeItemKey={(_idx, row) => row.originalIndex}
        defaultItemHeight={26}
        increaseViewportBy={200}
        components={virtuosoComponents}
        className="flex-1 min-h-0 scrollbar-none"
        itemContent={(_idx, { turn, originalIndex: i }) => {
          const included = selectedSet === null ? true : selectedSet.has(i)
          const preview = firstLinePreview(turn.body)
          return (
            <div
              data-testid="share-editor-turn-row"
              data-row-turn-index={i}
              data-included={included ? '' : undefined}
              className={`group flex items-center gap-3 pl-4 pr-4 py-1 transition-colors hover:bg-warm-surface dark:hover:bg-dark-surface ${
                included ? '' : 'opacity-60'
              }`}
            >
              <button
                type="button"
                data-testid="share-editor-turn-toggle"
                data-row-turn-index={i}
                onClick={() => toggleTurn(i)}
                title={included ? t('shareEditorPanel.turnSelector_clickExclude') : t('shareEditorPanel.turnSelector_clickInclude')}
                aria-pressed={included}
                aria-label={included
                  ? t('shareEditorPanel.turnSelector_excludeMsg', { index: i + 1 })
                  : t('shareEditorPanel.turnSelector_includeMsg', { index: i + 1 })}
                className="shrink-0 p-1 -m-1 rounded"
              >
                <span
                  className={`block w-[14px] h-[14px] rounded-[3px] flex items-center justify-center transition-colors ${
                    included
                      ? 'bg-accent dark:bg-accent-dark'
                      : 'border border-warm-border2 dark:border-dark-border2'
                  }`}
                  aria-hidden="true"
                >
                  {included && <Check size={10} strokeWidth={2.5} className="text-white" />}
                </span>
              </button>
              <button
                type="button"
                data-testid="share-editor-turn-jump"
                data-row-turn-index={i}
                onClick={() => jumpToTurn(i)}
                title={previewTooltip(turn.body)}
                aria-label={t('shareEditorPanel.turnSelector_jumpToMsg', { index: i + 1 })}
                className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
              >
                <span className="font-mono text-[10.5px] tabular-nums text-warm-faint dark:text-dark-faint shrink-0">
                  {padIndex(i + 1, total)}
                </span>
                <span className="text-[12px] text-warm-text dark:text-dark-text truncate flex-1">
                  {preview || <span className="text-warm-faint dark:text-dark-faint italic">{t('shareEditorPanel.turnSelector_empty_body')}</span>}
                </span>
              </button>
            </div>
          )
        }}
      />
    </div>
  )
}

/** Longer body excerpt used as the native tooltip on row hover.
 *  Collapses internal whitespace and truncates at ~240 chars so the
 *  OS tooltip doesn't run off the screen. */
function previewTooltip(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= 240) return collapsed
  return collapsed.slice(0, 240).trimEnd() + '…'
}

/** Strip a few obvious markdown markers from the first non-empty line. */
function firstLinePreview(body: string): string {
  const lines = body.split('\n')
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    return trimmed
      .replace(/^`{3,}.*$/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/`/g, '')
      .trim()
  }
  return ''
}

/** Zero-pad to the digit width of `total` so columns align. */
function padIndex(n: number, total: number): string {
  const width = Math.max(2, String(total).length)
  return String(n).padStart(width, '0')
}
