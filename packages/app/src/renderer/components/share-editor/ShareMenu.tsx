import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import type { Conversation, EditorOpts } from '@spool/share-kit'
import { useHotkeys } from '../../hooks/useHotkeys.js'
import { useSharePublish } from '../../featureFlags.js'
import type { PublishedRow, PublishSuccess } from '../../../shared/share-publish.js'
import { PublishTab } from './share-tabs/PublishTab.js'
import { ExportTab, type ExportFormat } from './share-tabs/ExportTab.js'
import { UnpublishConfirmModal } from './UnpublishConfirmModal.js'

type ShareTab = 'publish' | 'export'

type Props = {
  /** Draft id the editor is currently working on. Sent with the publish
   *  IPC so the backend can link the resulting share back to its source
   *  draft, and used to query the local cache for "is this already
   *  published?" on popover open. */
  draftId: string
  /** Lazy editor-state getter — called only when the user opens the
   *  popover or republishes, so we don't pay for a Conversation clone
   *  on every render. Returns null while the editor is still loading. */
  getEditorState: () => { conversation: Conversation; opts: EditorOpts } | null
  /** Called when the user clicks "Redact all" in the high-risk warning. */
  onRedactAll?: () => void
  /** Live publish state owned by the parent editor.
   *   - `undefined` → still loading (cache lookup in flight); tab strip
   *     suppresses the publish/manage flash until we know which to render.
   *   - `null` → no live share; popover opens in publish form.
   *   - `PublishSuccess` → live share exists; popover opens in manage view.
   *  Because this is the single source of truth, ShareMenu never holds
   *  its own copy — every transition (publish/republish/unpublish)
   *  bounces through `onPublishedChange`, which the parent then mirrors
   *  back via this prop. Eliminates the class of bugs where a stale
   *  myShares poll silently clobbered a local user action. */
  published: PublishSuccess | null | undefined
  /** True when the live draft has edits that aren't reflected in the
   *  currently-published snapshot — computed from the content hash on
   *  the cache row vs. a fresh hash of the editor state. Drives the
   *  "Unpublished edits" badge in the manage view. */
  hasUnpublishedEdits?: boolean
  /** Notified after publish / republish / unpublish so the parent can
   *  update its `published` state and any side effects (e.g. cache
   *  invalidation, toasts).
   *   - Publish/republish: `published` is the new PublishSuccess and
   *     `row` is the freshly-written cache row (use it as the
   *     authoritative new state; avoids racing the SWR refresh).
   *   - Unpublish: `published` is `null`, `row` is omitted. */
  onPublishedChange: (published: PublishSuccess | null, row?: PublishedRow) => void
  /** Export state — controlled by the editor (true while exporting). */
  exporting: boolean
  onExport: (fmt: ExportFormat) => void
}

/**
 * Single editor-topbar entry point for sharing. Replaces the separate
 * Publish + Export buttons with one Share popover that carries two tabs:
 *
 *   - Publish — the full spool.pro publish flow (visibility / expiry /
 *     PII gate / errors) plus the post-publish manage surface (URL,
 *     copy, view, republish, unpublish).
 *   - Export — the four local-only formats (PNG / PDF / Markdown /
 *     .spool) with a Download button.
 *
 * Both tabs render inline in the popover. The Unpublish confirmation
 * escalates to a centered modal because the action is irreversible at
 * the backend (R2 snapshot delete, slug permanently 410) — the popover
 * surface doesn't carry enough visual weight for that consequence.
 */
export function ShareMenu({
  draftId,
  getEditorState,
  onRedactAll,
  published,
  hasUnpublishedEdits = false,
  onPublishedChange,
  exporting,
  onExport,
}: Props) {
  const { t } = useTranslation()
  const lookupLoading = published === undefined
  // When the publish surface is flag-gated off, the popover collapses
  // to just the Export tab — no tab strip, no "Publish" entry to imply
  // a half-finished feature.
  const publishEnabled = useSharePublish()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ShareTab>(publishEnabled ? 'publish' : 'export')
  const [pending, setPending] = useState<{ conversation: Conversation; opts: EditorOpts } | null>(
    null,
  )
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false)
  const [unpublishBusy, setUnpublishBusy] = useState(false)
  const [unpublishError, setUnpublishError] = useState<string | null>(null)
  // Snapshot of the share being revoked, captured at requestUnpublish
  // time. We bind to this rather than to live `published` so the modal
  // can complete (or surface its error) even if the parent's SWR
  // refresh flips `published` to null mid-confirmation. Without this,
  // a concurrent /api/me/shares response that says "revoked" would
  // tear the modal out of the DOM while the user is mid-click and
  // strand the unpublish action.
  const [pendingUnpublish, setPendingUnpublish] = useState<PublishSuccess | null>(null)
  const [pendingUnpublishTitle, setPendingUnpublishTitle] = useState<string>('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  const refreshEditorState = useCallback(() => {
    const state = getEditorState()
    if (state) setPending(state)
  }, [getEditorState])

  const openPopover = useCallback(() => {
    refreshEditorState()
    setOpen(true)
  }, [refreshEditorState])

  const closePopover = useCallback(() => setOpen(false), [])

  // Outside-click + Esc close. Capture phase is required because the
  // editor's preview pane and control panel both call
  // stopPropagation('mousedown') to keep inner-pane drags from
  // bubbling — a bubble-phase listener would never fire for clicks
  // inside those zones. Memory: feedback_capture_phase_outside_click.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        // Don't close while a confirm modal is open above — the modal
        // owns Esc and outside-click for itself.
        if (!confirmingUnpublish) setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick, true)
    return () => document.removeEventListener('mousedown', onDocClick, true)
  }, [open, confirmingUnpublish])

  useHotkeys(
    {
      Escape: () => {
        if (confirmingUnpublish) return
        if (open) setOpen(false)
      },
    },
    { active: open && !confirmingUnpublish, modal: true },
  )

  // Re-sync editor state whenever the popover opens so the PII gate
  // sees the current draft (the user may have edited turns since the
  // last open).
  useEffect(() => {
    if (open) refreshEditorState()
  }, [open, refreshEditorState])

  function requestUnpublish() {
    if (!published) return
    setPendingUnpublish(published)
    setPendingUnpublishTitle(pending?.conversation.title || 'Untitled')
    setUnpublishError(null)
    setConfirmingUnpublish(true)
  }

  async function confirmUnpublish() {
    if (!pendingUnpublish || unpublishBusy) return
    setUnpublishBusy(true)
    setUnpublishError(null)
    try {
      await window.spoolShare.revoke(pendingUnpublish.id)
      onPublishedChange(null)
      setConfirmingUnpublish(false)
      setPendingUnpublish(null)
    } catch (err) {
      // The revoke IPC throws `Error('revoke <status>')`. On a 401 the
      // session is already cleared main-side (share-publish.ts) — surface
      // the same "session expired, sign in again" copy the publish path
      // uses instead of leaking the raw "revoke 401" status string.
      const msg = err instanceof Error ? err.message : ''
      setUnpublishError(
        /\b401\b/.test(msg)
          ? t('shareEditor.publishTab.error_sessionExpired')
          : msg || 'Could not unpublish.',
      )
    } finally {
      setUnpublishBusy(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative flex flex-none"
      data-testid="share-menu"
      style={noDragStyle}
    >
      <button
        type="button"
        data-testid="share-menu-trigger"
        onClick={() => (open ? closePopover() : openPopover())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[13px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity"
      >
        <span>{t('shareEditor.shareMenu.trigger')}</span>
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('shareEditor.shareMenu.popover_aria')}
          data-testid="share-menu-popover"
          className="absolute right-0 top-full mt-1.5 w-[380px] rounded-[10px] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border shadow-xl z-20 flex flex-col overflow-hidden"
        >
          {/* Tab strip — pill-style. Active tab gets a white card
              background; inactive tabs are flat muted text. Hidden
              entirely when Publish is flag-gated off (Export-only
              popover has no need for chrome). */}
          {publishEnabled && (
            <div
              role="tablist"
              aria-label={t('shareEditor.shareMenu.tablist_aria')}
              className="m-3 p-1 flex gap-1 rounded-md bg-warm-surface dark:bg-dark-surface"
            >
              {(['publish', 'export'] as const).map((id) => {
                const active = tab === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`share-menu-tab-${id}`}
                    onClick={() => setTab(id)}
                    // Inactive tab carries a transparent border so the
                    // 1px frame doesn't pop in/out and shift the row
                    // when switching. `focus:outline-none` kills the
                    // browser's default dark focus ring (the black
                    // flash the user was seeing); focus-visible adds a
                    // soft accent ring for keyboard users.
                    className={`flex-1 h-7 rounded text-[12px] font-medium transition-colors border focus:outline-none focus-visible:ring-1 focus-visible:ring-accent dark:focus-visible:ring-accent-dark ${
                      active
                        ? 'bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text shadow-[0_1px_2px_rgba(0,0,0,0.04)] border-warm-border/60 dark:border-dark-border/60'
                        : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text border-transparent'
                    }`}
                  >
                    {id === 'publish'
                      ? t('shareEditor.shareMenu.tab_publish')
                      : t('shareEditor.shareMenu.tab_export')}
                  </button>
                )
              })}
            </div>
          )}

          {/* When publishEnabled is false the tab is forced to
              'export' at mount and the Publish render branch is
              unreachable; the explicit guard here belt-and-suspenders
              against any future bug that flips `tab` from elsewhere. */}
          {publishEnabled && tab === 'publish' ? (
            lookupLoading ? (
              <div className="px-4 pb-4">
                <div className="h-32 rounded-md bg-warm-surface dark:bg-dark-surface animate-pulse" />
              </div>
            ) : (
              <PublishTab
                draftId={draftId}
                pending={pending}
                published={published ?? null}
                hasUnpublishedEdits={hasUnpublishedEdits}
                {...(onRedactAll && { onRedactAll })}
                onPublished={(r, row) => {
                  onPublishedChange(r, row)
                  // Keep popover open so the user immediately sees the
                  // "Published · ..." confirmation state without a
                  // separate toast disrupting the surface.
                }}
                onRequestUnpublish={requestUnpublish}
                onSignedIn={refreshEditorState}
              />
            )
          ) : (
            <ExportTab exporting={exporting} onExport={onExport} onClose={closePopover} />
          )}
        </div>
      )}

      {pendingUnpublish && (
        <UnpublishConfirmModal
          open={confirmingUnpublish}
          title={pendingUnpublishTitle}
          busy={unpublishBusy}
          error={unpublishError}
          onClose={() => {
            if (unpublishBusy) return
            setConfirmingUnpublish(false)
            setPendingUnpublish(null)
          }}
          onConfirm={() => { void confirmUnpublish() }}
        />
      )}
    </div>
  )
}
