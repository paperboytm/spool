// Cross-session "blast radius" for a credential finding.
//
// Spool dedupes a leaked value within a session (×N). This surfaces the
// uniquely-Spool view across the WHOLE archive: "this same key also
// appears in 4 other sessions across 2 projects". Collapsed by default
// to a single quiet line; expands to the per-session list on click.
//
// Boundary honesty: this is about Spool's own surfaces (search / AI /
// browse). The original ~/.claude session files are never touched.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { securityApi, type OccurrenceBySession } from '../../api/security.js'
import { getSessionSourceColor } from '../../../shared/sessionSources.js'
import type { SensitiveKind } from '@spool-lab/redact'

interface Props {
  kind: SensitiveKind
  valueHash: string
  /** Exclude the session the user is already looking at from the
   *  "elsewhere" framing — when provided, the headline counts other
   *  sessions only. The full list still shows every session. */
  currentSessionId?: number
  /** Notify when an occurrence list arrives, so the parent can decide
   *  whether to surface "purge everywhere" (layer 3). */
  onLoaded?: (rows: OccurrenceBySession[]) => void
}

export default function BlastRadius({ kind, valueHash, currentSessionId, onLoaded }: Props) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<OccurrenceBySession[] | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await securityApi.occurrencesByValueHash(kind, valueHash)
      setRows(r)
      onLoaded?.(r)
    } catch {
      setRows([])
    }
  }, [kind, valueHash, onLoaded])

  useEffect(() => { void load() }, [load])

  // Refetch when findings change anywhere (a purge / dismiss elsewhere
  // shrinks the radius). Debounced — burst purges collapse to one read.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = securityApi.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; void load() }, 300)
    })
    return () => { if (timer) clearTimeout(timer); off() }
  }, [load])

  if (rows === null) return null

  // Frame the headline around OTHER sessions: a value confined to the
  // session you're already looking at is covered by the in-session ×N
  // badge, so the radius only earns a line when the secret escaped
  // elsewhere.
  const others = currentSessionId === undefined
    ? rows
    : rows.filter(r => r.sessionId !== currentSessionId)
  const otherCount = others.length
  if (otherCount <= 0) return null
  // Projects among those OTHER sessions — only surfaced when it spans
  // more than one, so we never print the awkward "across 1 project".
  const projectCount = new Set(others.map(r => r.project ?? '__loose__')).size

  return (
    <div data-testid="blast-radius" data-sessions={otherCount} data-projects={projectCount}>
      <button
        type="button"
        data-testid="blast-radius-toggle"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1 h-5 px-1 -ml-1 rounded font-sans text-[11px] text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors"
      >
        <span>
          {t('security.blast_radius_sessions', {
            count: otherCount,
            defaultValue_one: 'Also in 1 other session',
            defaultValue_other: 'Also in {{count}} other sessions',
          })}
          {projectCount > 1 && ` · ${t('security.blast_radius_projects', { count: projectCount, defaultValue: '{{count}} projects' })}`}
        </span>
        <ChevronRight
          size={12}
          strokeWidth={1.7}
          aria-hidden
          className={`transition-transform duration-100 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <ul
          data-testid="blast-radius-list"
          className="mt-0.5 ml-1.5 flex flex-col gap-1 border-l border-warm-border dark:border-dark-border pl-2.5"
        >
          {others.map(r => (
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
                className="block w-1.5 h-1.5 rounded-full flex-none"
                style={{ background: getSessionSourceColor(r.source) }}
              />
              <span className="min-w-0 truncate">
                <span className="font-sans text-warm-text dark:text-dark-text">
                  {r.sessionTitle || t('common.untitled', { defaultValue: 'Untitled' })}
                </span>
                {r.project && (
                  <span className="font-mono text-warm-faint dark:text-dark-muted"> · {r.project}</span>
                )}
              </span>
              {r.count > 1 && (
                <span className="font-mono tabular-nums text-[10px] text-warm-faint dark:text-dark-muted">×{r.count}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
