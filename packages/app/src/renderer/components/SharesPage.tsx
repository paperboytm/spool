import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Newspaper, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getMonthDayFormatter } from '../../shared/formatDate.js'
import { useShareDrafts } from '../hooks/useShareDrafts'
import { useSpoolDrop } from '../hooks/useSpoolDrop.js'
import { sharePublicOrigin, sharePublicUrl } from '../lib/sharePublicUrl.js'
import { FeaturedEmptyState, SmallEmptyState } from './EmptyState.js'
import NewDraftPicker from './NewDraftPicker.js'
import type { ShareDraftListItem } from '@spool-lab/core'
import {
  TemplateRender,
  TEMPLATE_RATIO,
  TEMPLATES,
  paperTokens,
  type SpoolDocument,
} from '@spool/share-kit'
import { getSessionSourceColor } from '../../shared/sessionSources.js'

type Props = {
  onOpenDraft?: ((draft: ShareDraftListItem) => void) | undefined
  onImportSpool?: ((file: File) => void | Promise<void>) | undefined
  onStartNewDraft?: ((sessionUuid: string) => void | Promise<void>) | undefined
}

/**
 * The Drafts / Published tab strip is intentionally not rendered yet:
 * Phase 0 only has Drafts, and showing a Published tab that maps to a
 * "Coming in a future update" placeholder reads as a broken promise.
 * The tab strip lands in Phase 2 alongside the actual publish flow.
 */
export default function SharesPage({ onOpenDraft, onImportSpool, onStartNewDraft }: Props) {
  const { t } = useTranslation()
  const { drafts, loading, error, removeDraft, restoreDraft } = useShareDrafts()
  const hasDrafts = drafts.length > 0
  const [pickerOpen, setPickerOpen] = useState(false)

  const handleOpenPicker = useCallback(() => setPickerOpen(true), [])
  const handleClosePicker = useCallback(() => setPickerOpen(false), [])
  const handlePickSession = useCallback((uuid: string) => {
    setPickerOpen(false)
    void onStartNewDraft?.(uuid)
  }, [onStartNewDraft])

  const onImport = useCallback(
    (file: File) => onImportSpool?.(file),
    [onImportSpool],
  )
  const onRejectDrop = useCallback((files: File[]) => {
    const name = files[0]?.name ?? 'file'
    toast.error(t('shares.couldntImport', { name }), {
      description: t('shares.onlySpoolSupported'),
    })
  }, [t])
  const { isDragActive, dragHandlers } = useSpoolDrop({
    enabled: Boolean(onImportSpool),
    onImport,
    onReject: onRejectDrop,
  })

  const handleDelete = useCallback(async (draft: ShareDraftListItem) => {
    try {
      const full = await removeDraft(draft.draft_id)
      if (!full) return
      const title = draft.title || t('common.untitled')
      toast(t('shares.deletedToast', { title }), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            void restoreDraft(full).catch((err) => {
              console.error('Restore share draft failed:', err)
              toast.error(t('shares.couldntRestoreDraft'))
            })
          },
        },
      })
    } catch (err) {
      console.error('Delete share draft failed:', err)
      toast.error(t('shares.couldntDeleteDraft'))
    }
  }, [removeDraft, restoreDraft, t])

  return (
    <div data-testid="shares-page" className="relative flex flex-col flex-1 min-h-0" {...dragHandlers}>
      {isDragActive && <SpoolDropOverlay />}
      {hasDrafts && (
        <div className="flex-none flex items-center gap-3 px-6 pt-1.5 pb-3">
          <span className="font-mono text-[11px] text-warm-faint dark:text-dark-muted tabular-nums">
            {hasDrafts ? <>{t('shares.title')} · {drafts.length}</> : null}
          </span>
          {onStartNewDraft && (
            <button
              type="button"
              data-testid="shares-new-draft"
              onClick={handleOpenPicker}
              title={t('shares.newDraft')}
              aria-label={t('shares.newDraft')}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
            >
              <Plus size={13} strokeWidth={1.6} aria-hidden />
            </button>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <DraftsList
          drafts={drafts}
          loading={loading}
          error={error}
          onOpenDraft={onOpenDraft}
          onDeleteDraft={handleDelete}
          {...(onStartNewDraft ? { onStartNewDraft: handleOpenPicker } : {})}
        />
      </div>
      {pickerOpen && onStartNewDraft && (
        <NewDraftPicker onSelect={handlePickSession} onClose={handleClosePicker} />
      )}
    </div>
  )
}

function SpoolDropOverlay() {
  const { t } = useTranslation()
  // t('shares.dropToImport', { ext: '.spool' }) — render with monospace ext
  const parts = t('shares.dropToImport', { ext: '.spool' }).split('.spool')
  return (
    <div
      data-testid="shares-spool-drop-overlay"
      aria-hidden
      className="absolute inset-2 z-20 pointer-events-none flex items-center justify-center rounded-[10px] border border-dashed border-accent/70 dark:border-accent-dark/70 bg-accent-bg/60 dark:bg-accent-bg-dark/60 backdrop-blur-[1px]"
    >
      <p className="text-sm font-medium text-accent dark:text-accent-dark">
        {parts.flatMap((p, i, arr) => i < arr.length - 1
          ? [p, <span key={i} className="font-mono">.spool</span>]
          : [p])}
      </p>
    </div>
  )
}

function DraftsList({
  drafts,
  loading,
  error,
  onOpenDraft,
  onDeleteDraft,
  onStartNewDraft,
}: {
  drafts: ShareDraftListItem[]
  loading: boolean
  error: string | null
  onOpenDraft?: ((draft: ShareDraftListItem) => void) | undefined
  onDeleteDraft: (draft: ShareDraftListItem) => void
  onStartNewDraft?: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const [skeletonCount] = useState(readSkeletonCount)
  // Defer skeleton render by 150ms so sub-threshold loads (local sqlite is
  // usually <50ms) don't flash a meaningless placeholder. The same gate
  // applies to the screen-reader announcement: if loading is imperceptible
  // visually, there's no value announcing it either.
  const [showLoadingHint, setShowLoadingHint] = useState(false)
  useEffect(() => {
    if (!loading || drafts.length > 0) {
      setShowLoadingHint(false)
      return
    }
    const t = setTimeout(() => setShowLoadingHint(true), 150)
    return () => clearTimeout(t)
  }, [loading, drafts.length])
  useEffect(() => {
    if (!loading && !error) writeSkeletonCount(drafts.length)
  }, [loading, error, drafts.length])

  if (loading && drafts.length === 0) {
    if (!showLoadingHint) return null
    return (
      <>
        <span className="sr-only" role="status">{t('common.loading')}</span>
        {skeletonCount > 0 && <DraftsSkeleton count={skeletonCount} />}
      </>
    )
  }
  if (error) {
    return <SmallEmptyState>{`${t('common.error')}: ${error}`}</SmallEmptyState>
  }
  if (drafts.length === 0) {
    return (
      <FeaturedEmptyState
        icon={<Newspaper size={22} strokeWidth={1.5} />}
        title={t('shares.empty_title')}
        hint={t('shares.empty_body')}
        {...(onStartNewDraft ? {
          action: (
            <button
              type="button"
              data-testid="shares-empty-start"
              onClick={onStartNewDraft}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity"
            >
              <Plus size={14} strokeWidth={2} aria-hidden />
              <span>{t('shares.newDraft')}</span>
            </button>
          ),
        } : {})}
      />
    )
  }
  return (
    <ul
      className="grid gap-5 px-6 pb-6"
      style={{ gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)` }}
    >
      {drafts.map((draft) => (
        <li key={draft.draft_id}>
          <DraftCard draft={draft} onClick={onOpenDraft} onDelete={onDeleteDraft} />
        </li>
      ))}
    </ul>
  )
}

const CARD_W = 158
const FALLBACK_RATIO = { w: 720, h: 960 }

function DraftCard({
  draft,
  onClick,
  onDelete,
}: {
  draft: ShareDraftListItem
  onClick?: ((draft: ShareDraftListItem) => void) | undefined
  onDelete: (draft: ShareDraftListItem) => void
}) {
  const { t } = useTranslation()
  // The preview blob is a SpoolDocument-shaped subset: full opts +
  // conversation metadata + first ~6 turns. Card rendering only ever
  // reads at most that many turns (see thumbConvo below), so we never
  // need to hydrate the full snapshot here.
  const doc = useMemo<SpoolDocument | null>(() => {
    try {
      return JSON.parse(draft.preview_json) as SpoolDocument
    } catch {
      return null
    }
  }, [draft.preview_json])

  if (!doc) {
    return <CorruptDraftCard draft={draft} onClick={onClick} onDelete={onDelete} />
  }

  const ratio = TEMPLATE_RATIO[doc.opts.template] ?? FALLBACK_RATIO
  const scale = CARD_W / ratio.w
  const cardH = Math.round(CARD_W * (ratio.h / ratio.w))
  const tokens = paperTokens(doc.opts.paper)
  const templateName = TEMPLATES.find((t) => t.id === doc.opts.template)?.name ?? doc.opts.template

  // The template renders the whole conversation at native size; clipping
  // does the rest. Cap at 6 turns so a 200-message session doesn't make
  // every Shares-page mount measure the same 800-paragraph DOM tree
  // times the number of cards on screen.
  const thumbConvo = useMemo(
    () => ({ ...doc.conversation, turns: doc.conversation.turns.slice(0, 6) }),
    [doc.conversation],
  )

  const title = doc.conversation.title || t('common.untitled')
  const [hover, setHover] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div
      className="relative inline-block"
      style={{ width: CARD_W, height: cardH }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setConfirmingDelete(false)
      }}
    >
    <button
      type="button"
      data-testid="shares-draft-row"
      onClick={() => onClick?.(draft)}
      disabled={!onClick}
      aria-label={`${t('shares.openDraft')} ${title}`}
      className="group relative block overflow-hidden rounded-md cursor-pointer disabled:cursor-default"
      style={{
        width: CARD_W,
        height: cardH,
        background: tokens.paper,
        border: `1px solid ${tokens.border}`,
        boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.04)',
        textAlign: 'left',
        padding: 0,
        margin: 0,
      }}
    >
      {/* Scaled artifact preview clipped to the card. */}
      <span aria-hidden className="absolute inset-0 overflow-hidden block pointer-events-none">
        <span
          className="block"
          style={{
            width: ratio.w,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <TemplateRender template={doc.opts.template} convo={thumbConvo} opts={doc.opts} />
        </span>
      </span>

      {/* Paper-tinted fade so long conversations don't look hard-cropped. */}
      <span
        aria-hidden
        className="absolute left-0 right-0 bottom-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-0"
        style={{
          height: Math.round(cardH * 0.45),
          background: `linear-gradient(to bottom, ${tokens.paper}00 0%, ${tokens.paper}DD 55%, ${tokens.paper} 100%)`,
        }}
      />

      {/* Hover overlay — slim frosted-paper caption at the bottom.
          Backdrop-blur + paper color at ~75% opacity makes the strip
          read as a tinted glass band over the thumbnail rather than a
          flat shade. tokens.text drives the text color so any paper
          (bone / ink / linen / …) gets a legible caption without a
          theme branch. */}
      <span
        aria-hidden
        className="absolute left-0 right-0 bottom-0 flex flex-col gap-0.5 px-3 pt-2.5 pb-2.5 pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background: `${tokens.paper}BF`,
          backdropFilter: 'blur(8px) saturate(140%)',
          WebkitBackdropFilter: 'blur(8px) saturate(140%)',
          color: tokens.text,
        }}
      >
        <span className="text-[10.5px] font-medium leading-snug line-clamp-2 tracking-[-0.01em]">
          {title}
        </span>
        <span className="flex items-center gap-1.5 text-[9px]" style={{ color: tokens.muted }}>
          <span
            aria-hidden
            className="block w-1.5 h-1.5 rounded-full flex-none"
            style={{ background: getSessionSourceColor(doc.conversation.source) }}
          />
          <span className="font-mono uppercase tracking-[0.04em] flex-none">{formatRelative(draft.updated_at, t as unknown as RelativeT)}</span>
        </span>
      </span>
    </button>
      {hover && (
        <DeleteChip
          confirming={confirmingDelete}
          onClick={() => {
            if (confirmingDelete) {
              onDelete(draft)
              setConfirmingDelete(false)
            } else {
              setConfirmingDelete(true)
            }
          }}
        />
      )}
    </div>
  )
}

/**
 * Quilt-style click-twice delete affordance. Resting state is a small
 * X-chip in the top-right corner; first click expands it to a "Delete?"
 * pill with inverted colors; second click fires onClick. The parent
 * resets confirming state on mouse-leave so the pill never lingers in
 * its primed state after the user has moved on.
 */
function DeleteChip({ confirming, onClick }: { confirming: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <span
      role="button"
      tabIndex={0}
      data-testid="shares-draft-delete"
      data-confirming={confirming ? '' : undefined}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation()
          e.preventDefault()
          onClick()
        }
      }}
      aria-label={confirming ? t('shares.deleteConfirm_aria') : t('shares.deleteDraft')}
      title={confirming ? t('shares.deleteConfirm') : t('shares.deleteDraft')}
      className={`absolute top-1.5 right-1.5 z-10 h-5 min-w-5 inline-flex items-center justify-center rounded-full cursor-pointer select-none transition-[padding,background,color,border-color] duration-150 shadow-[0_1px_3px_rgba(0,0,0,0.12)] font-sans text-[10.5px] font-medium tracking-[0.02em] whitespace-nowrap ${
        confirming
          ? 'bg-warm-text dark:bg-dark-text text-warm-bg dark:text-dark-bg border border-warm-text dark:border-dark-text px-2'
          : 'bg-warm-bg dark:bg-dark-bg text-warm-muted dark:text-dark-muted border border-warm-border dark:border-dark-border'
      }`}
    >
      {confirming ? (
        t('shares.deleteLabel')
      ) : (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      )}
    </span>
  )
}

const SKELETON_COUNT_KEY = 'spool.shares.skeletonCount'
const SKELETON_COUNT_DEFAULT = 4
const SKELETON_COUNT_MAX = 24

function readSkeletonCount(): number {
  try {
    const raw = localStorage.getItem(SKELETON_COUNT_KEY)
    if (raw === null) return SKELETON_COUNT_DEFAULT
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return SKELETON_COUNT_DEFAULT
    return Math.min(Math.floor(n), SKELETON_COUNT_MAX)
  } catch {
    return SKELETON_COUNT_DEFAULT
  }
}

function writeSkeletonCount(n: number): void {
  try {
    const clamped = Math.min(Math.max(0, Math.floor(n)), SKELETON_COUNT_MAX)
    localStorage.setItem(SKELETON_COUNT_KEY, String(clamped))
  } catch {
    // localStorage can throw (private mode, quota); skeleton just falls
    // back to the default count on the next mount.
  }
}

function DraftsSkeleton({ count }: { count: number }) {
  const cardH = Math.round(CARD_W * (FALLBACK_RATIO.h / FALLBACK_RATIO.w))
  return (
    <ul
      aria-hidden
      data-testid="shares-skeleton"
      className="grid gap-5 px-6 pt-3 pb-6"
      style={{ gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <div
            className="rounded-md bg-warm-surface2 dark:bg-dark-surface2 border border-warm-border dark:border-dark-border opacity-60 animate-pulse"
            style={{ width: CARD_W, height: cardH }}
          />
        </li>
      ))}
    </ul>
  )
}

function CorruptDraftCard({
  draft,
  onDelete,
}: {
  draft: ShareDraftListItem
  onClick?: unknown
  onDelete: (draft: ShareDraftListItem) => void
}) {
  const { t } = useTranslation()
  const ratio = FALLBACK_RATIO
  const cardH = Math.round(CARD_W * (ratio.h / ratio.w))
  const title = draft.title || t('common.untitled')
  const [hover, setHover] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  return (
    <div
      className="relative inline-block"
      style={{ width: CARD_W, height: cardH }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setConfirmingDelete(false)
      }}
    >
      <div
        className="block rounded-md border border-dashed border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-warm-faint dark:text-dark-muted text-xs flex flex-col items-center justify-center gap-1 px-3 text-center"
        style={{ width: CARD_W, height: cardH }}
      >
        <span className="font-medium text-warm-text dark:text-dark-text line-clamp-2">{title}</span>
        <span>{t('shares.snapshotUnreadable')}</span>
        <span>{t('shares.editedRelative', { when: formatRelative(draft.updated_at, t as unknown as RelativeT) })}</span>
      </div>
      {hover && (
        <DeleteChip
          confirming={confirmingDelete}
          onClick={() => {
            if (confirmingDelete) {
              onDelete(draft)
              setConfirmingDelete(false)
            } else {
              setConfirmingDelete(true)
            }
          }}
        />
      )}
    </div>
  )
}

type RelativeT = (key: string, opts?: Record<string, unknown>) => string

function formatRelative(iso: string, t?: RelativeT): string {
  const parsed = Date.parse(iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(parsed)) return iso
  const diffSec = Math.max(0, Math.round((Date.now() - parsed) / 1000))
  const tx = t ?? ((k: string, o?: Record<string, unknown>) => {
    if (k === 'shares.justNow') return 'just now'
    if (k === 'shares.minutesAgo') return `${(o as { count?: number }).count}m ago`
    if (k === 'shares.hoursAgo') return `${(o as { count?: number }).count}h ago`
    if (k === 'shares.daysAgo') return `${(o as { count?: number }).count}d ago`
    return k
  })
  if (diffSec < 60) return tx('shares.justNow')
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return tx('shares.minutesAgo', { count: diffMin })
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return tx('shares.hoursAgo', { count: diffHr })
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return tx('shares.daysAgo', { count: diffDay })
  // Use the app's UI language (set on <html lang>) rather than the OS
  // locale so an English macOS doesn't show "Mar 14" inside a Chinese UI.
  const locale = typeof document !== 'undefined' && document.documentElement.lang
    ? document.documentElement.lang
    : undefined
  return getMonthDayFormatter(locale, false).format(new Date(parsed))
}
