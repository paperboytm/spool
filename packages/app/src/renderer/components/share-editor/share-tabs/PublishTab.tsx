import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  computeExpiresAt,
  computeUnredactedMatches,
  type ExpiryOption,
} from '../publish-logic.js'
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

/**
 * The Publish tab of the Share popover. State machine:
 *
 *   1. authLoading            → tiny skeleton
 *   2. !user (signed out)     → ConnectCard
 *   3. published              → manage view (URL, copy, view, republish, unpublish)
 *   4. draft + signed in      → publish form (visibility / expiry / PII / submit)
 *
 * Errors (401 / 429 / network) render inline above the footer with a
 * "Try again" button. Custom expiry validation is wired through the
 * same `validateCustomExpiry` helper as before — past timestamps lock
 * the Publish button and surface a red hint.
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
  const { user, loading: authLoading, refresh: refreshAuth } = useShareAuth()
  const [visibility, setVisibility] = useState<Visibility>('unlisted')
  const [expires, setExpires] = useState<ExpiryOption>('never')
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
      const expires_at = computeExpiresAt({ kind: expires })
      // Deterministic key — a dropped-response retry of this exact
      // intent will hash to the same token and the backend will
      // short-circuit to the original slug. Any edit to the snapshot
      // body / visibility / expiry produces a fresh key.
      const idempotency_key = await computePublishIdempotencyKey({
        snapshot,
        visibility,
        expires_at: expires_at ?? null,
      })
      const res = await window.spoolShare.publish({
        snapshot,
        visibility,
        draft_id: draftId,
        idempotency_key,
        ...(expires_at !== undefined && { expires_at }),
        ...(published?.id !== undefined && { override_slug: published.id }),
      })
      if (!res.ok) {
        if (res.status === 401) {
          setError('Your session expired — sign in again to publish.')
        } else if (res.status === 429) {
          setError('Too many publishes. Try again in a few minutes.')
        } else {
          setError(res.error.detail ?? res.error.error ?? 'Publish failed. Check your connection and try again.')
        }
        return
      }
      onPublished(res.data, res.row)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed. Check your connection and try again.')
    } finally {
      publishingRef.current = false
      setPublishing(false)
    }
  }

  // ── State 1: auth loading ─────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="px-4 pb-4">
        <div className="h-32 rounded-md bg-warm-surface dark:bg-dark-surface animate-pulse" />
      </div>
    )
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
  return (
    <div className="flex flex-col">
      {high.length > 0 && (
        <PiiHighWarning
          count={high.length}
          rows={high.slice(0, HIGH_ROW_LIMIT)}
          extra={high.length - HIGH_ROW_LIMIT}
          {...(onRedactAll && { onRedactAll })}
          blocked={highBlocked}
        />
      )}

      {medium.length > 0 && (
        <PiiMediumWarning
          count={medium.length}
          rows={medium.slice(0, 12)}
          extra={medium.length - 12}
          open={mediumOpen}
          onToggle={() => setMediumOpen((v) => !v)}
        />
      )}

      <fieldset disabled={publishing} className="px-4 pb-3">
        <legend className="text-[11.5px] font-medium text-warm-muted dark:text-dark-muted">
          Visibility
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <VisibilityCard
            icon={<LinkIcon size={15} strokeWidth={1.75} aria-hidden />}
            title="Link only"
            description="Anyone with the link."
            checked={visibility === 'unlisted'}
            onSelect={() => setVisibility('unlisted')}
          />
          <VisibilityCard
            icon={<FileText size={15} strokeWidth={1.75} aria-hidden />}
            title="On profile"
            description={hasHandle ? 'Listed on your @handle.' : 'Needs a handle.'}
            checked={visibility === 'profile-listed'}
            disabled={!hasHandle}
            onSelect={() => setVisibility('profile-listed')}
          />
        </div>
      </fieldset>

      {/* Expires — fixed presets only. Custom date picker dropped on
       *  purpose:
       *   - GitHub gists, Notion, Linear, Figma, Google Docs, Slack:
       *     no expiry at all (revoke only).
       *   - Dropbox, Loom, Vercel: fixed presets (7/30/90 days), no
       *     custom date.
       *  Nobody in the industry offers a datetime-local picker for
       *  share-link expiry — the UI is heavy, the value proposition
       *  is low (users don't pick "5:42pm on March 14"), and the
       *  preview was clashing visually with the Spool aesthetic. If
       *  a real ask for arbitrary dates lands later, reintroduce as
       *  a date-only picker (no time component). */}
      <fieldset disabled={publishing} className="px-4 pb-3">
        <legend className="text-[11.5px] font-medium text-warm-muted dark:text-dark-muted">
          Expires
        </legend>
        <select
          value={expires}
          onChange={(e) => setExpires(e.target.value as ExpiryOption)}
          data-testid="share-menu-expires"
          className="mt-2 w-full h-8 px-2.5 rounded-md border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-[12px] text-warm-text dark:text-dark-text focus:outline-none focus:ring-1 focus:ring-accent dark:focus:ring-accent-dark"
        >
          <option value="never">Never</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
          <option value="90d">90 days</option>
        </select>
      </fieldset>

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
        hint="A snapshot uploads to spool.pro. Revoke any time."
        action={
          highBlocked ? (
            <button
              type="button"
              data-testid="share-menu-confirm-anyway"
              onClick={() => setHighOverride(true)}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-white bg-[color:var(--color-status-error)] hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Publish anyway
            </button>
          ) : (
            <button
              type="button"
              data-testid="share-menu-submit"
              onClick={() => { void handlePublish() }}
              disabled={publishing || !pending}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-white transition-opacity disabled:opacity-60 disabled:cursor-not-allowed ${
                high.length > 0
                  ? 'bg-[color:var(--color-status-error)] hover:opacity-90'
                  : 'bg-accent dark:bg-accent-dark hover:opacity-90'
              }`}
            >
              {publishing
                ? <><Loader2 size={12} strokeWidth={1.8} className="animate-spin" aria-hidden />Publishing…</>
                : error
                  ? 'Try again'
                  : <><Send size={12} strokeWidth={1.8} aria-hidden />{high.length > 0 ? 'Publish anyway' : 'Publish'}</>
              }
            </button>
          )
        }
      />
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────

function VisibilityCard({
  icon,
  title,
  description,
  checked,
  disabled,
  onSelect,
}: {
  icon: React.ReactNode
  title: string
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
      data-testid={`share-menu-visibility-${title.toLowerCase().replace(/\s+/g, '-')}`}
      onClick={onSelect}
      disabled={disabled}
      className={`relative text-left rounded-md p-2.5 border transition-colors disabled:cursor-not-allowed ${
        checked
          ? 'border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
          : disabled
            ? 'border-warm-border/60 dark:border-dark-border/60 opacity-55'
            : 'border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
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
  count,
  rows,
  extra,
  onRedactAll,
  blocked,
}: {
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
            {count} credential-like value{count === 1 ? '' : 's'} would publish unredacted
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
                +{extra} more
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
                Redact all
              </button>
            )}
          </div>
          {blocked && (
            <p className="mt-2 text-[11px] text-warm-muted dark:text-dark-muted">
              Click <span className="font-medium">Publish anyway</span> below to confirm you intend to publish these values as-is.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function PiiMediumWarning({
  count,
  rows,
  extra,
  open,
  onToggle,
}: {
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
          {count} identity / location signal{count === 1 ? '' : 's'} (email, phone, name, path)
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
              +{extra} more
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function PublishedManageView({
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
    <div className="flex flex-col">
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11.5px] text-[color:var(--color-status-success,#3E7D52)] dark:text-[color:var(--color-status-success-dark,#6FB286)]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
            <span>Published · v{published.version}</span>
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
              title="The live draft differs from the published snapshot. Republish to push your edits."
            >
              <span className="inline-block w-1 h-1 rounded-full bg-current" />
              Unpublished edits
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
              ? <><Check size={12} strokeWidth={1.8} aria-hidden /> Copied</>
              : <><Copy size={12} strokeWidth={1.8} aria-hidden /> Copy</>}
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
            label={republishing ? 'Republishing…' : hasUnpublishedEdits ? 'Republish' : 'Up to date'}
            onClick={onRepublish}
            disabled={republishDisabled}
          />
          <ActionButton
            icon={<EyeOff size={12} strokeWidth={1.8} aria-hidden />}
            label="Unpublish"
            danger
            onClick={onUnpublish}
            disabled={republishing}
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
        hint="Snapshot lives at the link above. Revoke any time."
        action={
          <button
            type="button"
            data-testid="share-menu-open-share"
            onClick={onView}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity"
          >
            <ExternalLink size={12} strokeWidth={1.8} aria-hidden />
            Open share
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
}: {
  icon: React.ReactNode
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
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
