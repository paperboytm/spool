import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  EyeOff,
  FileText,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react'
import type { Conversation, EditorOpts } from '@spool/share-kit'
import { computeUnredactedMatches } from '../publish-logic.js'
import { buildSnapshotFromEditor } from '../snapshot-adapter.js'
import { ConnectCard } from '../ConnectCard.js'
import { useShareAuth } from '../../../hooks/useShareAuth.js'
import { computePublishIdempotencyKey } from '../../../lib/publishIdempotency.js'
import type { PublishedRow, PublishSuccess, Visibility } from '../../../../shared/share-publish.js'

type Props = {
  /** Draft id this publish flow is bound to. Threaded into the publish
   *  IPC body so the backend can link the resulting share row back to
   *  its source draft (see published_shares.draft_id). */
  draftId: string
  /** Editor's current Conversation + opts. Null when the editor is
   *  still loading — the PII gate has no input until this resolves. */
  pending: { conversation: Conversation; opts: EditorOpts } | null
  /** Non-null when the current snapshot is already published. Drives
   *  the "manage" state (URL row + Copy / View / Republish / Unpublish). */
  published: PublishSuccess | null
  /** True when the live draft has edits not yet pushed to the published
   *  snapshot. Drives the "Unpublished edits" badge in the manage view. */
  hasUnpublishedEdits?: boolean
  onRedactAll?: () => void
  /** Invoked on successful publish/republish. Carries the cache row
   *  main just wrote alongside the slimmer PublishSuccess shape so the
   *  parent can update its state without re-reading the cache (which
   *  could race an in-flight myShares poll's `replaceAll`). */
  onPublished: (r: PublishSuccess, row: PublishedRow) => void
  /** Lifted to ShareMenu so the irreversible action gets a centered
   *  confirm modal — that pattern doesn't fit inside the popover. */
  onRequestUnpublish: () => void
  /** Called after the embedded ConnectCard completes sign-in, so the
   *  parent can re-fetch the live editor state if needed. */
  onSignedIn: () => void
}

const HIGH_ROW_LIMIT = 6

// Public profiles (/@handle pages) are cut from the launch scope, and
// the backend gates handle claiming off (share-backend
// PROFILES_ENABLED env var). Without a claimable handle the
// "On profile" card could never be enabled, so offering the picker
// would only show a permanently-disabled option — every publish is
// link-only instead. Flip together with the backend flag (and
// PROFILES_ENABLED in share-web) if user feedback brings profiles back.
const SHOW_VISIBILITY_PICKER = false

/**
 * The Publish tab of the Share popover. State machine:
 *
 *   1. authLoading            → tiny skeleton
 *   2. !user (signed out)     → ConnectCard
 *   3. published              → manage view (URL, copy, view, republish, unpublish)
 *   4. draft + signed in      → publish form (visibility / PII / submit)
 *
 * Errors (401 / 429 / network) render inline above the footer with a
 * "Try again" button.
 */
export function PublishTab({
  draftId,
  pending,
  published,
  hasUnpublishedEdits = false,
  onRedactAll,
  onPublished,
  onRequestUnpublish,
  onSignedIn,
}: Props) {
  const { t } = useTranslation()
  const { user, loading: authLoading, refresh: refreshAuth } = useShareAuth()
  const [visibility, setVisibility] = useState<Visibility>('unlisted')
  const [publishing, setPublishing] = useState(false)
  // Synchronous mutex against double-submit. React only flips the
  // disabled prop on the next render, so a rapid double-click on
  // Republish can queue two concurrent handlePublish invocations
  // before the button's `disabled` reaches the DOM. The ref blocks
  // the second one immediately in the same task.
  const publishingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [highOverride, setHighOverride] = useState(false)
  const [mediumOpen, setMediumOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const { high, medium } = useMemo(() => {
    if (!pending) return { high: [], medium: [] }
    return computeUnredactedMatches(pending.conversation, pending.opts)
  }, [pending])

  const highBlocked = high.length > 0 && !highOverride
  const hasHandle = !!user?.handle

  // If the user picks profile-listed then loses their handle eligibility
  // (e.g. account-state change between popover opens), snap back to
  // unlisted so we don't submit an invalid combo.
  useEffect(() => {
    if (!hasHandle && visibility === 'profile-listed') {
      setVisibility('unlisted')
    }
  }, [hasHandle, visibility])

  // Drop the override flag once the high tier clears.
  useEffect(() => {
    if (high.length === 0 && highOverride) setHighOverride(false)
  }, [high.length, highOverride])

  async function handlePublish() {
    // Synchronous mutex first, then the state-flag check. The state
    // flag still matters for the rare case where publishingRef has
    // somehow desynced (test mocks); both being true means abort.
    if (publishingRef.current || highBlocked || publishing || !pending) return
    publishingRef.current = true
    setPublishing(true)
    setError(null)
    try {
      const snapshot = buildSnapshotFromEditor({
        conversation: pending.conversation,
        opts: pending.opts,
      })
      // Deterministic key — a dropped-response retry of this exact
      // intent will hash to the same token and the backend will
      // short-circuit to the original slug. Any edit to the snapshot
      // body / visibility produces a fresh key.
      const idempotency_key = await computePublishIdempotencyKey({
        snapshot,
        visibility,
      })
      const res = await window.spoolShare.publish({
        snapshot,
        visibility,
        draft_id: draftId,
        idempotency_key,
        ...(published?.id !== undefined && { override_slug: published.id }),
      })
      if (!res.ok) {
        if (res.status === 401) {
          setError(t('shareEditor.publishTab.error_sessionExpired'))
        } else if (res.status === 429) {
          setError(t('shareEditor.publishTab.error_rateLimited'))
        } else {
          setError(res.error.detail ?? res.error.error ?? t('shareEditor.publishTab.error_generic'))
        }
        return
      }
      onPublished(res.data, res.row)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shareEditor.publishTab.error_generic'))
    } finally {
      publishingRef.current = false
      setPublishing(false)
    }
  }

  // ── State 1: auth loading ─────────────────────────────────────────
  if (authLoading) {
    return <PublishTabSkeleton />
  }

  // ── State 2: signed out — embed the ConnectCard ──────────────────
  if (!user) {
    return (
      <div className="px-4 pb-4">
        <ConnectCard
          onSignedIn={() => {
            void refreshAuth()
            onSignedIn()
          }}
        />
      </div>
    )
  }

  // ── State 3: already published — manage view ─────────────────────
  if (published) {
    // Republish is disabled when:
    //  - `pending` hasn't loaded yet (publish path would silently no-op,
    //    leaving the user with no feedback),
    //  - the snapshot hash matches the published row (drift badge is
    //    OFF). The backend's idempotency short-circuit would return
    //    the same version, so the user clicks Republish and nothing
    //    changes — surfacing the disabled state up front is more
    //    honest than letting the click look successful.
    const republishDisabled = publishing || !pending || !hasUnpublishedEdits
    return <PublishedManageView
      t={t}
      published={published}
      hasUnpublishedEdits={hasUnpublishedEdits}
      copied={copied}
      onCopy={async () => {
        try {
          await navigator.clipboard.writeText(published.url)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          /* ignore */
        }
      }}
      onView={() => window.open(published.url, '_blank', 'noopener,noreferrer')}
      onRepublish={() => {
        // Same submit path as the publish form, but `published?.id`
        // makes handlePublish stamp `override_slug` so the backend
        // updates this row instead of minting a new slug.
        void handlePublish()
      }}
      onUnpublish={onRequestUnpublish}
      republishing={publishing}
      republishDisabled={republishDisabled}
      error={error}
    />
  }

  // ── State 4: signed in + draft — publish form ────────────────────
  // How many turns actually publish: an active TurnSelector selection
  // wins over the raw conversation length.
  const publishTurnCount = pending
    ? pending.opts.selected?.length ?? pending.conversation.turns.length
    : null

  return (
    <div className="flex flex-col" data-testid="share-menu-form">
      {high.length > 0 && (
        <PiiHighWarning
          t={t}
          count={high.length}
          rows={high.slice(0, HIGH_ROW_LIMIT)}
          extra={high.length - HIGH_ROW_LIMIT}
          {...(onRedactAll && { onRedactAll })}
          blocked={highBlocked}
        />
      )}

      {medium.length > 0 && (
        <PiiMediumWarning
          t={t}
          count={medium.length}
          rows={medium.slice(0, 12)}
          extra={medium.length - 12}
          open={mediumOpen}
          onToggle={() => setMediumOpen((v) => !v)}
        />
      )}

      {/* Snapshot summary — with the visibility picker cut, this card
       *  is what tells the user what's about to go out and who can see
       *  it: title + published-turn count, then the link-only note
       *  (reusing the retired picker's copy, so no new translations). */}
      <div className="px-4 pb-3">
        <div
          data-testid="share-menu-snapshot-card"
          className="flex items-center gap-2 rounded-md border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3 py-2"
        >
          <span className="inline-flex w-7 h-7 flex-none items-center justify-center rounded-md bg-warm-bg dark:bg-dark-bg text-warm-muted dark:text-dark-muted">
            <FileText size={15} strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-warm-text dark:text-dark-text truncate">
              {pending ? pending.conversation.title || t('common.untitled') : '—'}
            </div>
            <div className="text-[11px] font-mono text-warm-muted dark:text-dark-muted">
              {publishTurnCount !== null
                ? t('shareEditor.publishTab.snapshot_turns', { count: publishTurnCount })
                : '—'}
            </div>
          </div>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-warm-muted dark:text-dark-muted">
          <LinkIcon size={12} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden />
          <span>
            <span className="font-medium">{t('shareEditor.publishTab.visibility_link_title')}</span>
            {' — '}
            {t('shareEditor.publishTab.visibility_link_description')}
          </span>
        </p>
      </div>

      {SHOW_VISIBILITY_PICKER && <fieldset disabled={publishing} className="px-4 pb-3">
        <legend className="text-[11.5px] font-medium text-warm-muted dark:text-dark-muted">
          {t('shareEditor.publishTab.visibility_legend')}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <VisibilityCard
            icon={<LinkIcon size={15} strokeWidth={1.75} aria-hidden />}
            title={t('shareEditor.publishTab.visibility_link_title')}
            testId="share-menu-visibility-link-only"
            description={t('shareEditor.publishTab.visibility_link_description')}
            checked={visibility === 'unlisted'}
            onSelect={() => setVisibility('unlisted')}
          />
          <VisibilityCard
            icon={<FileText size={15} strokeWidth={1.75} aria-hidden />}
            title={t('shareEditor.publishTab.visibility_profile_title')}
            testId="share-menu-visibility-on-profile"
            description={hasHandle
              ? t('shareEditor.publishTab.visibility_profile_description_listed')
              : t('shareEditor.publishTab.visibility_profile_description_needsHandle')}
            checked={visibility === 'profile-listed'}
            disabled={!hasHandle}
            onSelect={() => setVisibility('profile-listed')}
          />
        </div>
      </fieldset>}

      {error && (
        <p
          role="alert"
          data-testid="share-menu-error"
          className="mx-4 mb-3 flex items-start gap-1.5 text-[11.5px] text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]"
        >
          <AlertTriangle size={12} strokeWidth={1.8} className="mt-0.5 flex-none" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      <Footer
        hint={t('shareEditor.publishTab.footerHint')}
        action={
          highBlocked ? (
            <button
              type="button"
              data-testid="share-menu-confirm-anyway"
              onClick={() => setHighOverride(true)}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-white bg-[color:var(--color-status-error)] hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {t('shareEditor.publishTab.publishAnyway')}
            </button>
          ) : (
            <button
              type="button"
              data-testid={high.length > 0 ? 'share-menu-submit-unredacted' : 'share-menu-submit'}
              onClick={() => { void handlePublish() }}
              disabled={publishing || !pending}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-white transition-opacity disabled:opacity-60 disabled:cursor-not-allowed ${
                high.length > 0
                  ? 'bg-[color:var(--color-status-error)] hover:opacity-90'
                  : 'bg-accent dark:bg-accent-dark hover:opacity-90'
              }`}
            >
              {publishing
                ? <><Loader2 size={12} strokeWidth={1.8} className="animate-spin" aria-hidden />{t('shareEditor.publishTab.publishing')}</>
                : error
                  ? t('shareEditor.publishTab.tryAgain')
                  // After the high-risk override, the submit button must NOT
                  // re-use the "Publish anyway" label — that's the same text
                  // and same spot as the override button, so a second click
                  // on the same pixel would publish unredacted credentials.
                  // Switch to an explicit "Publish unredacted" confirm so the
                  // live-publish click is visibly distinct from the override.
                  : high.length > 0
                    ? <><AlertTriangle size={12} strokeWidth={1.8} aria-hidden />{t('shareEditor.publishTab.publishUnredacted')}</>
                    : <><Send size={12} strokeWidth={1.8} aria-hidden />{t('shareEditor.publishTab.publish')}</>
              }
            </button>
          )
        }
      />
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────

/**
 * Loading placeholder mirroring the signed-in publish form's layout
 * (snapshot card + note line + footer), so neither the cache-lookup
 * skeleton (ShareMenu) nor the auth skeleton (state 1 above) causes a
 * height jump when the real form swaps in. The previous flat h-32
 * block was ~2× the post-picker-cut form height and made the popover
 * visibly shrink on open.
 */
export function PublishTabSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden>
      <div className="px-4 pb-3">
        <div className="h-[46px] rounded-md bg-warm-surface dark:bg-dark-surface animate-pulse" />
        <div className="mt-2 h-4 w-2/3 rounded bg-warm-surface dark:bg-dark-surface animate-pulse" />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-warm-border/60 dark:border-dark-border/60 bg-warm-surface/40 dark:bg-dark-surface/40">
        <div className="h-4 w-1/2 rounded bg-warm-surface dark:bg-dark-surface animate-pulse" />
        <div className="h-8 w-24 rounded-md bg-warm-surface dark:bg-dark-surface animate-pulse" />
      </div>
    </div>
  )
}

function VisibilityCard({
  icon,
  title,
  testId,
  description,
  checked,
  disabled,
  onSelect,
}: {
  icon: React.ReactNode
  title: string
  testId: string
  description: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-testid={testId}
      onClick={onSelect}
      disabled={disabled}
      className={`relative flex flex-col text-left rounded-md p-2.5 border transition-colors disabled:cursor-not-allowed ${
        checked
          ? 'border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
          : disabled
            ? 'border-warm-border/60 dark:border-dark-border/60 opacity-55'
            : 'border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
      }`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className={`inline-flex w-7 h-7 items-center justify-center rounded-md ${
          checked
            ? 'bg-accent text-white dark:bg-accent-dark'
            : 'bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted'
        }`}>
          {icon}
        </span>
        <span className={`inline-flex w-4 h-4 items-center justify-center rounded-full border ${
          checked
            ? 'bg-accent dark:bg-accent-dark border-accent dark:border-accent-dark'
            : 'border-warm-border2 dark:border-dark-border2 bg-transparent'
        }`}>
          {checked && <Check size={10} strokeWidth={2.5} className="text-white" aria-hidden />}
        </span>
      </div>
      <div className="mt-2 text-[12.5px] font-semibold text-warm-text dark:text-dark-text">
        {title}
      </div>
      <div
        className="mt-0.5 text-[11px] leading-snug text-warm-muted dark:text-dark-muted"
        // text-wrap: balance evens out the line breaks for short
        // 2-line descriptions so "Listed on your /\n@handle" doesn't
        // dangle an orphan. Supported in all modern browsers Electron
        // bundles; falls through silently elsewhere.
        style={{ textWrap: 'balance' as React.CSSProperties['textWrap'] }}
      >
        {description}
      </div>
    </button>
  )
}

function PiiHighWarning({
  t,
  count,
  rows,
  extra,
  onRedactAll,
  blocked,
}: {
  t: ReturnType<typeof useTranslation>['t']
  count: number
  rows: { label: string; preview: string; turn_index: number; start: number }[]
  extra: number
  onRedactAll?: () => void
  blocked: boolean
}) {
  return (
    <section
      data-testid="share-menu-pii-high"
      className="mx-4 mb-3 rounded-md border border-[color:var(--color-status-error)]/40 bg-[color:var(--color-status-error)]/10 px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          strokeWidth={1.8}
          aria-hidden
          className="mt-0.5 flex-none text-[color:var(--color-status-error)]"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-warm-text dark:text-dark-text">
            {t('shareEditor.publishTab.pii_high_warning', { count })}
          </p>
          <ul className="mt-1.5 space-y-1">
            {rows.map((m, i) => (
              <li
                key={`${m.turn_index}-${m.start}-${i}`}
                className="text-[11px] text-warm-muted dark:text-dark-muted flex items-center gap-2"
              >
                <span className="font-medium">{m.label}</span>
                <code className="font-mono text-[10.5px] px-1 rounded bg-warm-surface dark:bg-dark-surface">
                  {m.preview}
                </code>
              </li>
            ))}
            {extra > 0 && (
              <li className="text-[10.5px] italic text-warm-faint dark:text-dark-muted">
                {t('shareEditor.publishTab.pii_more', { count: extra })}
              </li>
            )}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {onRedactAll && (
              <button
                type="button"
                onClick={onRedactAll}
                data-testid="share-menu-redact-all"
                className="text-[11px] font-medium underline text-warm-text dark:text-dark-text hover:opacity-80"
              >
                {t('shareEditor.publishTab.pii_redactAll')}
              </button>
            )}
          </div>
          {blocked && (
            <p className="mt-2 text-[11px] text-warm-muted dark:text-dark-muted">
              {t('shareEditor.publishTab.pii_blocked_hint_prefix')} <span className="font-medium">{t('shareEditor.publishTab.pii_blocked_hint_emphasis')}</span> {t('shareEditor.publishTab.pii_blocked_hint_suffix')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function PiiMediumWarning({
  t,
  count,
  rows,
  extra,
  open,
  onToggle,
}: {
  t: ReturnType<typeof useTranslation>['t']
  count: number
  rows: { label: string; preview: string; turn_index: number; start: number }[]
  extra: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <section
      data-testid="share-menu-pii-medium"
      className="mx-4 mb-3 rounded-md border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3 py-2"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-[11.5px] text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
      >
        {open
          ? <ChevronDown size={12} strokeWidth={1.8} aria-hidden />
          : <ChevronRight size={12} strokeWidth={1.8} aria-hidden />}
        <span>
          {t('shareEditor.publishTab.pii_medium_signals', { count })}
        </span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 pl-4">
          {rows.map((m, i) => (
            <li
              key={`${m.turn_index}-${m.start}-${i}`}
              className="text-[11px] text-warm-muted dark:text-dark-muted flex items-center gap-2"
            >
              <span className="font-medium">{m.label}</span>
              <code className="font-mono text-[10.5px] px-1 rounded bg-warm-bg dark:bg-dark-bg">
                {m.preview}
              </code>
            </li>
          ))}
          {extra > 0 && (
            <li className="text-[10.5px] italic text-warm-faint dark:text-dark-muted">
              {t('shareEditor.publishTab.pii_more', { count: extra })}
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function PublishedManageView({
  t,
  published,
  hasUnpublishedEdits,
  copied,
  onCopy,
  onView,
  onRepublish,
  onUnpublish,
  republishing,
  republishDisabled,
  error,
}: {
  t: ReturnType<typeof useTranslation>['t']
  published: PublishSuccess
  hasUnpublishedEdits: boolean
  copied: boolean
  onCopy: () => void | Promise<void>
  onView: () => void
  onRepublish: () => void
  onUnpublish: () => void
  republishing: boolean
  /** Disable the Republish button (in-flight, snapshot not loaded,
   *  or no drift). Disjoint from `republishing` so the spin animation
   *  stays accurate. */
  republishDisabled: boolean
  error: string | null
}) {
  // URL display: strip https:// for compactness, the user knows what it is.
  const displayUrl = published.url.replace(/^https?:\/\//, '')
  return (
    <div className="flex flex-col" data-testid="share-menu-manage-view">
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--color-status-success,#3E7D52)] dark:text-[color:var(--color-status-success-dark,#6FB286)]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
            <span>{t('shareEditor.publishTab.published_status', { version: published.version })}</span>
          </div>
          {hasUnpublishedEdits && (
            // Drift indicator — the live draft hashes differently from
            // the published snapshot, so a Republish click would
            // actually push a new version. Amber (warning, not error)
            // and inline with the Published row so users see drift the
            // moment they reopen the popover.
            <span
              data-testid="share-menu-unpublished-edits"
              className="inline-flex items-center gap-1 px-1.5 h-4 rounded-[3px] text-[10px] font-medium bg-accent-bg dark:bg-[#2A1800] text-accent dark:text-accent-dark"
              title={t('shareEditor.publishTab.unpublishedEdits_title')}
            >
              <span className="inline-block w-1 h-1 rounded-full bg-current" />
              {t('shareEditor.publishTab.unpublishedEdits')}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-stretch gap-1.5">
          <div className="flex-1 min-w-0 inline-flex items-center px-2.5 rounded-md border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-[12px] font-mono text-warm-text dark:text-dark-text overflow-hidden">
            <span className="truncate" title={published.url}>{displayUrl}</span>
          </div>
          <button
            type="button"
            data-testid="share-menu-copy"
            onClick={() => { void onCopy() }}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11.5px] font-medium text-warm-text dark:text-dark-text border border-warm-border2 dark:border-dark-border2 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
          >
            {copied
              ? <><Check size={12} strokeWidth={1.8} aria-hidden /> {t('shareEditor.publishTab.copied')}</>
              : <><Copy size={12} strokeWidth={1.8} aria-hidden /> {t('shareEditor.publishTab.copy')}</>}
          </button>
        </div>

        {/* Two actions: Republish (refresh snapshot) + Unpublish
         *  (irreversible). "View" is intentionally NOT here — the
         *  primary accent CTA in the footer ("Open share") is the
         *  obvious open-in-browser affordance, so duplicating it as
         *  a small icon button just clutters the row. */}
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <ActionButton
            icon={<RefreshCw size={12} strokeWidth={1.8} className={republishing ? 'animate-spin' : ''} aria-hidden />}
            label={republishing
              ? t('shareEditor.publishTab.republishing')
              : hasUnpublishedEdits
                ? t('shareEditor.publishTab.republish')
                : t('shareEditor.publishTab.upToDate')}
            onClick={onRepublish}
            disabled={republishDisabled}
            testid="share-menu-republish"
          />
          <ActionButton
            icon={<EyeOff size={12} strokeWidth={1.8} aria-hidden />}
            label={t('shareEditor.publishTab.unpublish')}
            danger
            onClick={onUnpublish}
            disabled={republishing}
            testid="share-menu-unpublish"
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-4 mb-3 flex items-start gap-1.5 text-[11.5px] text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]"
        >
          <AlertTriangle size={12} strokeWidth={1.8} className="mt-0.5 flex-none" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      <Footer
        hint={t('shareEditor.publishTab.footerHint_published')}
        action={
          <button
            type="button"
            data-testid="share-menu-open-share"
            onClick={onView}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity"
          >
            <ExternalLink size={12} strokeWidth={1.8} aria-hidden />
            {t('shareEditor.publishTab.openShare')}
          </button>
        }
      />
    </div>
  )
}

function ActionButton({
  icon,
  label,
  danger,
  disabled,
  onClick,
  testid,
}: {
  icon: React.ReactNode
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
  testid?: string
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1 h-7 rounded text-[11.5px] font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        danger
          ? 'text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)] border-[color:var(--color-status-error)]/30 hover:bg-[color:var(--color-status-error)]/8'
          : 'text-warm-text dark:text-dark-text border-warm-border2 dark:border-dark-border2 hover:bg-warm-surface dark:hover:bg-dark-surface'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function Footer({ hint, action }: { hint: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-warm-border/60 dark:border-dark-border/60 bg-warm-surface/40 dark:bg-dark-surface/40">
      <p className="flex-1 min-w-0 text-[11px] text-warm-muted dark:text-dark-muted leading-snug">
        {hint}
      </p>
      {action}
    </div>
  )
}
