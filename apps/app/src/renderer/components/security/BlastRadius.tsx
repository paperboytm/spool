// Cross-session "blast radius" for a credential finding.
//
// Spool dedupes a leaked value within a session (×N). This surfaces the
// uniquely-Spool view across the WHOLE archive: the same key in N OTHER
// sessions. The at-rest affordance is a tiny ⧉N badge on the finding's
// value row (rendered by the parent off `onCount`); this component owns
// the data + the expanded per-session list, shown only when `expanded`.
//
// Boundary honesty: this is about Spool's own surfaces (search / AI /
// browse). The original ~/.claude session files are never touched.

import { HIGH_SEVERITY_KINDS, type SensitiveKind } from '@spool-lab/redact'
import { Eraser } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionSourceColor } from '../../../shared/sessionSources.js'
import { securityApi, type OccurrenceBySession } from '../../api/security.js'
import PurgeConfirmDialog from './PurgeConfirmDialog.js'

interface Props {
  kind: SensitiveKind
  valueHash: string
  /** Exclude the session the user is already looking at — the count is
   *  framed around OTHER sessions, since the in-session ×N badge already
   *  covers the current one. */
  currentSessionId?: number
  /** Controlled: render the per-session list only when expanded. The
   *  trigger is the value-row ⧉N badge owned by the parent. */
  expanded: boolean
  /** Report the OTHER-session count up so the parent can render (or
   *  hide) the badge. Fires on load + whenever a purge/dismiss shrinks
   *  the radius. */
  onCount: (otherCount: number) => void
}

export default function BlastRadius({
  kind,
  valueHash,
  currentSessionId,
  expanded,
  onCount,
}: Props) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<OccurrenceBySession[] | null>(null)
  const [purgePending, setPurgePending] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await securityApi.occurrencesByValueHash(kind, valueHash))
    } catch {
      setRows([])
    }
  }, [kind, valueHash])

  useEffect(() => {
    void load()
  }, [load])

  // Refetch when findings change anywhere (a purge / dismiss elsewhere
  // shrinks the radius). Debounced — burst purges collapse to one read.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = securityApi.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void load()
      }, 300)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [load])

  const others =
    rows === null
      ? []
      : currentSessionId === undefined
        ? rows
        : rows.filter((r) => r.sessionId !== currentSessionId)
  const otherCount = others.length

  // Drive the parent's value-row badge. onCount is a stable setter, so
  // depending on it is safe; runs only when the count actually moves.
  useEffect(() => {
    onCount(otherCount)
  }, [otherCount, onCount])

  // Nothing to expand (value confined to the current session / nowhere),
  // or the parent hasn't toggled it open. The badge — when otherCount > 0
  // — lives on the value row, rendered by the parent.
  if (otherCount <= 0 || !expanded) return null

  // "Purge everywhere" scrubs every copy across ALL sessions (including
  // the one being viewed), so its count spans the whole archive.
  const totalCopies = (rows ?? []).reduce((sum, r) => sum + r.count, 0)
  const isCredential = HIGH_SEVERITY_KINDS.has(kind)

  async function purgeEverywhere() {
    try {
      await securityApi.purgeEverywhere(kind, valueHash)
    } catch {
      /* surfaces via onChange → refetch shrinks the radius */
    }
    await load()
  }

  return (
    <div data-testid="blast-radius" data-sessions={otherCount}>
      <ul
        data-testid="blast-radius-list"
        className="border-warm-border dark:border-dark-border mt-1 ml-1.5 flex flex-col gap-1 border-l pl-2.5"
      >
        {others.map((r) => (
          <li
            key={r.sessionId}
            data-testid="blast-radius-row"
            data-session-id={r.sessionId}
            className="grid items-center gap-1.5 text-[11px] leading-4"
            style={{ gridTemplateColumns: 'auto 1fr auto' }}
          >
            <span
              aria-hidden
              data-testid="source-dot"
              data-source={r.source}
              className="block h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: getSessionSourceColor(r.source) }}
            />
            <span className="min-w-0 truncate">
              <span className="text-warm-text dark:text-dark-text font-sans">
                {r.sessionTitle || t('common.untitled', { defaultValue: 'Untitled' })}
              </span>
              {r.project && (
                <span className="text-warm-faint dark:text-dark-muted font-mono">
                  {' '}
                  · {r.project}
                </span>
              )}
            </span>
            {r.count > 1 && (
              <span className="text-warm-faint dark:text-dark-muted font-mono text-[10px] tabular-nums">
                ×{r.count}
              </span>
            )}
          </li>
        ))}
        {/* Close the loop: after rotating at the source, scrub every copy
         *  from Spool's surfaces in one transaction. The bulk
         *  PurgeConfirmDialog makes clear the originals in ~/.claude are
         *  untouched. Credentials only — the same tier that gets the
         *  radius. */}
        {isCredential && (
          <li>
            <button
              type="button"
              data-testid="purge-everywhere"
              onClick={() => setPurgePending(true)}
              className="text-warm-muted dark:text-dark-muted hover:text-accent dark:hover:text-accent-dark -ml-0.5 inline-flex h-5 items-center gap-1.5 rounded font-sans text-[11px] transition-colors"
            >
              <Eraser size={12} strokeWidth={1.7} aria-hidden />
              {t('security.purge_everywhere_cta', {
                count: totalCopies,
                defaultValue_one: 'Purge everywhere · {{count}} copy',
                defaultValue_other: 'Purge everywhere · {{count}} copies',
              })}
            </button>
          </li>
        )}
      </ul>
      <PurgeConfirmDialog
        open={purgePending}
        count={totalCopies}
        kind={kind}
        bulk
        hasCredential={isCredential}
        onConfirm={() => {
          setPurgePending(false)
          void purgeEverywhere()
        }}
        onCancel={() => setPurgePending(false)}
      />
    </div>
  )
}
