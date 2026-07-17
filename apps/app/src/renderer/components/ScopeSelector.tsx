import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X as XIcon, ChevronDown } from 'lucide-react'
import type { ProjectGroup } from '@spool-lab/core'
import { useHotkeys } from '../hooks/useHotkeys.js'

/**
 * The minimum a parent needs to identify the current scope. ProjectGroup
 * carries more (kind, source list, counts) but only `identityKey` and
 * `displayName` are needed by the selector and most parent state.
 */
export type ScopeValue = Pick<ProjectGroup, 'identityKey' | 'displayName'>

type Props = {
  value: ScopeValue | null
  onChange: (next: ScopeValue | null) => void
  /** Fires whenever the popover closes (Escape / outside click / select). */
  onPopoverClose?: () => void
  /** Stable per-host prefix for e2e test ids. */
  testIdPrefix?: string
}

export default function ScopeSelector({
  value,
  onChange,
  onPopoverClose,
  testIdPrefix = 'scope',
}: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectGroup[] | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then((rows) => { if (!cancelled) setProjects(rows) })
      .catch(() => { if (!cancelled) setProjects([]) })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={`${testIdPrefix}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={`text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors ${
          value
            ? 'text-accent dark:text-accent-dark bg-accent/10 dark:bg-accent-dark/10 hover:bg-accent/15 dark:hover:bg-accent-dark/15'
            : 'text-warm-faint dark:text-dark-muted bg-warm-surface2/60 dark:bg-dark-surface2/60 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
        }`}
      >
        <span className="max-w-[220px] truncate">
          {value ? value.displayName : t('scope.any')}
        </span>
        <ChevronDown size={10} strokeWidth={2} aria-hidden className="opacity-60" />
      </button>
      {value && (
        <button
          type="button"
          data-testid={`${testIdPrefix}-clear`}
          onClick={() => onChange(null)}
          aria-label={t('scope.clear')}
          className="p-0.5 rounded text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2"
        >
          <XIcon size={11} strokeWidth={2} aria-hidden />
        </button>
      )}
      {open && (
        <ScopePopover
          anchorRef={triggerRef}
          projects={projects ?? []}
          selectedKey={value?.identityKey ?? null}
          testIdPrefix={testIdPrefix}
          onSelect={(p) => {
            onChange(p)
            setOpen(false)
            onPopoverClose?.()
          }}
          onClose={() => {
            setOpen(false)
            onPopoverClose?.()
          }}
        />
      )}
    </>
  )
}

function ScopePopover({
  anchorRef,
  projects,
  selectedKey,
  testIdPrefix,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  projects: ProjectGroup[]
  selectedKey: string | null
  testIdPrefix: string
  onSelect: (p: ScopeValue | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const trig = anchorRef.current
    if (!trig) return
    const measure = () => {
      const r = trig.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorRef])

  useEffect(() => { inputRef.current?.focus() }, [])

  // Modal layer: Escape closes the popover before any outer modal sees it.
  useHotkeys({ Escape: onClose }, { modal: true })

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    // Capture phase: bypass any inner-modal `stopPropagation` shield on
    // mousedown, which would otherwise hide outside clicks from window.
    window.addEventListener('mousedown', handleMouseDown, true)
    return () => window.removeEventListener('mousedown', handleMouseDown, true)
  }, [onClose, anchorRef])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? projects.filter(p => p.displayName.toLowerCase().includes(q))
      : projects
    return [...list].sort((a, b) => (b.lastSessionAt ?? '').localeCompare(a.lastSessionAt ?? ''))
  }, [projects, query])

  if (!pos) return null

  return createPortal(
    <div
      ref={rootRef}
      data-testid={`${testIdPrefix}-popover`}
      role="dialog"
      onMouseDown={(e) => e.stopPropagation()}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[60] w-[280px] rounded-md border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-lg overflow-hidden"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('scope.searchPlaceholder')}
        className="w-full px-3 py-2 text-[12px] bg-transparent outline-none text-warm-text dark:text-dark-text placeholder:text-warm-faint border-b border-warm-border/50 dark:border-dark-border/50"
      />
      <div className="max-h-[240px] overflow-y-auto py-1">
        <button
          type="button"
          data-testid={`${testIdPrefix}-option`}
          data-identity-key=""
          onClick={() => onSelect(null)}
          className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-warm-surface2 dark:hover:bg-dark-surface2 ${
            selectedKey === null
              ? 'text-warm-text dark:text-dark-text font-medium'
              : 'text-warm-muted dark:text-dark-muted'
          }`}
        >
          {t('scope.any')}
        </button>
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-warm-faint dark:text-dark-muted">
            {query.trim() ? t('scope.noMatch') : t('scope.noProjects')}
          </p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.identityKey}
              type="button"
              data-testid={`${testIdPrefix}-option`}
              data-identity-key={p.identityKey}
              onClick={() => onSelect({ identityKey: p.identityKey, displayName: p.displayName })}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] hover:bg-warm-surface2 dark:hover:bg-dark-surface2 ${
                p.identityKey === selectedKey
                  ? 'text-warm-text dark:text-dark-text font-medium'
                  : 'text-warm-muted dark:text-dark-muted'
              }`}
            >
              <span className="truncate">{p.displayName}</span>
              <span className="flex-none font-mono text-[10px] text-warm-faint dark:text-dark-muted tabular-nums">
                {p.sessionCount}
              </span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  )
}
