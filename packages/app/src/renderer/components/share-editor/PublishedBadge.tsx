import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type PublishedBadgeAction =
  | { kind: 'view' }
  | { kind: 'copy' }
  | { kind: 'republish' }
  | { kind: 'unpublish' }

type Props = {
  url: string
  onAction: (action: PublishedBadgeAction) => void
}

/**
 * "Published ✓" pill rendered in place of PublishButton once a share
 * has been published. Click → small dropdown with View / Copy /
 * Republish / Unpublish. Mirrors the DownloadButton dropdown chrome so
 * the editor topbar reads as a coherent action row.
 */
export function PublishedBadge({ url, onAction }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (action: PublishedBadgeAction) => {
    setOpen(false)
    onAction(action)
  }

  return (
    <div
      ref={rootRef}
      className="relative flex flex-none"
      data-testid="published-badge"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        data-testid="published-badge-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={url}
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[12px] font-medium text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark border border-accent/30 dark:border-accent-dark/30 hover:opacity-90 transition-opacity"
      >
        <Check size={12} strokeWidth={2} aria-hidden />
        <span>Published</span>
        <ChevronDown size={11} strokeWidth={1.8} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-[180px] rounded-md bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border shadow-lg p-1 z-20"
        >
          {(['view', 'copy', 'republish', 'unpublish'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              data-testid={`published-badge-${k}`}
              onClick={() => pick({ kind: k })}
              className={`w-full text-left px-2.5 py-1.5 rounded-[5px] text-[12px] transition-colors hover:bg-warm-surface dark:hover:bg-dark-surface ${
                k === 'unpublish'
                  ? 'text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]'
                  : 'text-warm-text dark:text-dark-text'
              }`}
            >
              {k === 'view' ? 'View on spool.share'
                : k === 'copy' ? 'Copy link'
                : k === 'republish' ? 'Republish'
                : 'Unpublish'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
