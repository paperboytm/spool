import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, EyeOff, Link as LinkIcon, Loader2, Newspaper, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getMonthDayFormatter } from '../../shared/formatDate.js'
import { useShareDrafts } from '../hooks/useShareDrafts'
import { useShareAuth } from '../hooks/useShareAuth.js'
import { usePublishedShares } from '../hooks/usePublishedShares.js'
import { useSharePublish } from '../featureFlags.js'
import { useSpoolDrop } from '../hooks/useSpoolDrop.js'
import { sharePublicOrigin, sharePublicUrl } from '../lib/sharePublicUrl.js'
import { FeaturedEmptyState, SmallEmptyState } from './EmptyState.js'
import NewDraftPicker from './NewDraftPicker.js'
import type { PublishedShareCacheItem, ShareDraftListItem } from '@spool-lab/core'
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

type SharesTab = 'drafts' | 'published'

export default function SharesPage({ onOpenDraft, onImportSpool, onStartNewDraft }: Props) {
  const { t } = useTranslation()
  const { drafts, loading, error, removeDraft, restoreDraft } = useShareDrafts()
  const hasDrafts = drafts.length > 0
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tab, setTab] = useState<SharesTab>('drafts')
  // Published tab is sub-gated behind `sharePublish` — when the publish
  // backend is off, Shares is drafts-only and the tab strip disappears.
  const publishEnabled = useSharePublish()

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
      <div className="flex-none flex items-center gap-3 px-6 pt-1.5 pb-3">
        {publishEnabled ? (
          <SharesTabStrip tab={tab} onTab={setTab} draftsCount={drafts.length} />
        ) : (
          // sharePublish off: no tab strip, just a single "Drafts" label
          // in the same visual slot — matches the pre-publish baseline so
          // the header doesn't collapse to a lone + icon.
          <div
            className="inline-flex items-center gap-1.5 h-6 px-2 font-mono text-[11px] tabular-nums text-warm-text dark:text-dark-text"
            aria-label="Drafts"
          >
            <span>Drafts</span>
            {drafts.length > 0 && (
              <span className="text-warm-faint dark:text-dark-muted">
                {drafts.length}
              </span>
            )}
          </div>
        )}
        {(tab === 'drafts' || !publishEnabled) && onStartNewDraft && (
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
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'drafts' || !publishEnabled ? (
          <DraftsList
            drafts={drafts}
            loading={loading}
            error={error}
            onOpenDraft={onOpenDraft}
            onDeleteDraft={handleDelete}
            {...(onStartNewDraft ? { onStartNewDraft: handleOpenPicker } : {})}
          />
        ) : (
          <PublishedList />
        )}
      </div>
      {pickerOpen && onStartNewDraft && (
        <NewDraftPicker onSelect={handlePickSession} onClose={handleClosePicker} />
      )}
    </div>
  )
}

function SharesTabStrip({
  tab,
  onTab,
  draftsCount,
}: {
  tab: SharesTab
  onTab: (next: SharesTab) => void
  draftsCount: number
}) {
  const items: Array<{ id: SharesTab; label: string; count?: number }> = [
    { id: 'drafts', label: 'Drafts', count: draftsCount },
    { id: 'published', label: 'Published' },
  ]
  return (
    <div role="tablist" aria-label="Shares" className="inline-flex items-center gap-1">
      {items.map((it) => {
        const active = it.id === tab
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={active}
            data-testid={`shares-tab-${it.id}`}
            onClick={() => onTab(it.id)}
            className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-[4px] font-mono text-[11px] tabular-nums transition-colors ${
              active
                ? 'text-warm-text dark:text-dark-text bg-warm-surface2 dark:bg-dark-surface2'
                : 'text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
            }`}
          >
            <span>{it.label}</span>
            {typeof it.count === 'number' && it.count > 0 && <span>· {it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

function PublishedList() {
  const { user, loading: authLoading, signIn } = useShareAuth()
  const { items, loading, refresh, noteLocalMutation } = usePublishedShares()
  const [busyId, setBusyId] = useState<string | null>(null)

  // Re-fetch the published list when this window regains focus — picks up
  // remote revocations (user opened spool.pro/me on the web and revoked)
  // that the desktop wouldn't otherwise see until a manual restart.
  useEffect(() => {
    if (!user) return
    function onFocus() { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [user, refresh])

  // After signing in via the empty-state CTA, the hook's initial mount
  // ran with no token and returned an empty list. Trigger a manual
  // refresh so the list actually populates. Errors surface as a toast
  // — without this the button appears to do nothing on failure (the
  // IPC rejection bubbles through `void` and the user gets no feedback).
  const [signingIn, setSigningIn] = useState(false)
  async function handleSignIn() {
    if (signingIn) return
    setSigningIn(true)
    try {
      await signIn()
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Strip Electron's "Error invoking remote method '…': Error:" wrapper
      // so the toast reads as a plain product error, not a stack trace.
      const cleaned = msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
      toast.error("Couldn't sign in", { description: cleaned })
    } finally {
      setSigningIn(false)
    }
  }

  // Auth-loading flicker fix: render a skeleton while useShareAuth is
  // resolving the cookie. Without this, the brief `user === null`
  // window before `/me` returns paints the "Sign in" CTA, then snaps
  // to the published list. The skeleton matches the same shape as
  // the post-auth loading state below so the transition is invisible.
  if (authLoading) {
    return (
      <ul data-testid="published-skeleton" className="flex flex-col gap-1 px-3 pb-6" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="h-[64px] rounded-md bg-warm-surface dark:bg-dark-surface animate-pulse"
            style={{ opacity: 1 - i * 0.2 }}
          />
        ))}
      </ul>
    )
  }

  if (!user) {
    return (
      <FeaturedEmptyState
        icon={<Newspaper size={22} strokeWidth={1.5} />}
        title="Sign in to see your published shares"
        hint="Spool only uploads snapshots you explicitly publish. Drafts and your library stay on this machine."
        action={(
          <button
            type="button"
            data-testid="published-signin"
            onClick={() => { void handleSignIn() }}
            disabled={signingIn}
            className="inline-flex items-center gap-2 h-8 px-3 rounded-md text-[12px] font-medium bg-white dark:bg-dark-surface2 text-[#1C1C18] dark:text-dark-text border border-warm-border2 dark:border-dark-border2 hover:border-accent hover:dark:border-accent-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <svg width={15} height={15} viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" fill="#34A853" />
              <path d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33z" fill="#FBBC05" />
              <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335" />
            </svg>
            Sign in with Google
          </button>
        )}
      />
    )
  }

  if (loading && items.length === 0) {
    // Network fetch can take several hundred ms — return a minimal
    // skeleton instead of a blank panel so the user has feedback.
    return (
      <ul data-testid="published-skeleton" className="flex flex-col gap-1 px-3 pb-6" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="h-[64px] rounded-md bg-warm-surface dark:bg-dark-surface animate-pulse"
            style={{ opacity: 1 - i * 0.2 }}
          />
        ))}
      </ul>
    )
  }

  if (items.length === 0) {
    return (
      <FeaturedEmptyState
        icon={<Newspaper size={22} strokeWidth={1.5} />}
        title="No published shares yet"
        hint="When you publish a draft, it shows up here so you can manage it from any signed-in Spool."
      />
    )
  }

  const onCopy = async (it: PublishedShareCacheItem) => {
    try {
      await navigator.clipboard.writeText(sharePublicUrl(it.id))
      toast.success('Link copied')
    } catch {
      toast.error("Couldn't copy link")
    }
  }

  const onView = (it: PublishedShareCacheItem) => {
    window.open(sharePublicUrl(it.id), '_blank', 'noopener,noreferrer')
  }

  const onUnpublish = async (it: PublishedShareCacheItem) => {
    if (busyId) return
    setBusyId(it.id)
    // Tell the hook a local mutation is starting so any focus-triggered
    // refresh whose myShares response is in flight skips its cache
    // replaceAll — otherwise it would stomp the optimistic revoke
    // that main writes via markRevoked between here and the final
    // post-revoke refresh below.
    noteLocalMutation()
    try {
      await window.spoolShare.revoke(it.id)
      toast.success('Share unpublished')
      await refresh()
    } catch (err) {
      console.error('Unpublish failed:', err)
      toast.error("Couldn't unpublish")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ul data-testid="published-list" className="flex flex-col gap-1 px-3 pb-6">
      {items.map((it) => (
        <PublishedRow
          key={it.id}
          item={it}
          busy={busyId === it.id}
          onCopy={() => void onCopy(it)}
          onView={() => onView(it)}
          onUnpublish={() => void onUnpublish(it)}
        />
      ))}
    </ul>
  )
}

function PublishedRow({
  item,
  busy,
  onCopy,
  onView,
  onUnpublish,
}: {
  item: PublishedShareCacheItem
  busy: boolean
  onCopy: () => void
  onView: () => void
  onUnpublish: () => void
}) {
  const revoked = item.revoked_at !== null
  // "Soon" means within 7 days — flagging a year-from-now expiry as
  // "expiring soon" defeats the badge's purpose. The Expires row in
  // the UI still appears via this guard, so renamed to reflect the
  // narrow window.
  const EXPIRE_SOON_MS = 7 * 24 * 60 * 60 * 1000
  const expiresSoon = item.expires_at !== null
    && item.expires_at > Date.now()
    && item.expires_at - Date.now() < EXPIRE_SOON_MS
  const publishedLabel = new Date(item.published_at).toLocaleDateString()
  return (
    <li
      data-testid="published-row"
      data-revoked={revoked ? '' : undefined}
      className={`group flex items-center gap-3 rounded-[7px] px-3 py-2.5 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors ${
        revoked ? 'opacity-55' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[14px] font-medium text-warm-text dark:text-dark-text truncate">
            {item.title || 'Untitled'}
          </span>
          {revoked && (
            <span className="inline-flex items-center px-1.5 h-4 rounded-[3px] text-[9px] font-medium uppercase tracking-[0.06em] bg-warm-surface2 dark:bg-dark-surface2 text-warm-faint dark:text-dark-muted">
              Revoked
            </span>
          )}
          {item.visibility === 'profile-listed' && !revoked && (
            <span className="inline-flex items-center px-1.5 h-4 rounded-[3px] text-[9px] font-medium uppercase tracking-[0.06em] bg-accent-bg dark:bg-[#2A1800] text-accent dark:text-accent-dark">
              Listed
            </span>
          )}
          {expiresSoon && !revoked && (
            <span className="inline-flex items-center px-1.5 h-4 rounded-[3px] text-[9px] font-medium uppercase tracking-[0.06em] bg-warm-surface2 dark:bg-dark-surface2 text-warm-muted dark:text-dark-muted">
              Expires {new Date(item.expires_at as number).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-warm-faint dark:text-dark-muted">
          <span className="font-mono">{sharePublicOrigin().replace(/^https?:\/\//, '')}/s/{item.id}</span>
          <span aria-hidden>·</span>
          <span>Published {publishedLabel}</span>
        </div>
      </div>
      {/* Action icons always visible — matches the share-web Me page
       *  Published-row design. Hover-to-reveal was strictly tidier
       *  but produced a "what can I do here?" gap that the web list
       *  doesn't have. */}
      <div className="flex-none flex items-center gap-0.5">
        <RowAction label="View" onClick={onView}><ExternalLink size={13} strokeWidth={1.6} /></RowAction>
        <RowAction label="Copy link" onClick={onCopy}><LinkIcon size={13} strokeWidth={1.6} /></RowAction>
        {!revoked && (
          <RowAction label={busy ? 'Unpublishing' : 'Unpublish'} onClick={onUnpublish} disabled={busy}>
            {busy
              ? <Loader2 size={13} strokeWidth={1.6} className="animate-spin" />
              : <EyeOff size={13} strokeWidth={1.6} />}
          </RowAction>
        )}
      </div>
    </li>
  )
}

function RowAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
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
