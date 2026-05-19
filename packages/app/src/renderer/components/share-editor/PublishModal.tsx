import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { Conversation, EditorOpts } from '@spool/share-kit'
import {
  computeExpiresAt,
  computeUnredactedMatches,
  type ExpiryOption,
} from './publish-logic.js'
import { buildSnapshotFromEditor } from './snapshot-adapter.js'
import type { PublishSuccess, Visibility } from '../../../shared/share-publish.js'

type Props = {
  /** Raw conversation + opts — the modal runs the PII gate against
   *  these (pre-redact) so it can warn about anything the policy is
   *  about to let through. The submit path runs them through
   *  `buildSnapshotFromEditor`, which applies the same redact
   *  pipeline before sending. */
  conversation: Conversation
  opts: EditorOpts
  hasHandle: boolean
  /** Present when republishing an already-live share. */
  existingSlug?: string
  /** Invoked when the user clicks "Redact all" in the high-risk
   *  warning — flips the editor's opts.redact to true so the
   *  blocking matches get covered by the policy. */
  onRedactAll?: () => void
  onClose: () => void
  onPublished: (r: PublishSuccess) => void
}

const HIGH_ROW_LIMIT = 6

/**
 * Publish-confirmation modal. Client-side PII gate splits matches into
 * two tiers:
 *
 *  - High risk (credentials, financial / identity IDs) blocks publish
 *    behind a two-click "Publish anyway" confirmation. The user is
 *    encouraged to either "Redact all" (flips `opts.redact: true`) or
 *    head back to the editor.
 *
 *  - Medium risk (email, phone, person name, paths, hosts) is
 *    surfaced in a fold-out hint but never blocks publish. The user
 *    has already seen the privacy panel; this is a "did you mean to
 *    keep these?" reminder.
 *
 * The actual snapshot sent to the backend is produced by
 * `buildSnapshotFromEditor`, which applies the same `redactConversation`
 * pipeline — so `turns[].content` on the wire is the already-masked
 * literal. The backend does NOT rescan; the client gate is the sole
 * boundary for what reaches R2.
 */
export function PublishModal({
  conversation,
  opts,
  hasHandle,
  existingSlug,
  onRedactAll,
  onClose,
  onPublished,
}: Props) {
  const [visibility, setVisibility] = useState<Visibility>('unlisted')
  const [expires, setExpires] = useState<ExpiryOption>('never')
  const [customExpiry, setCustomExpiry] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highOverride, setHighOverride] = useState(false)
  const [mediumOpen, setMediumOpen] = useState(false)

  const { high, medium } = useMemo(
    () => computeUnredactedMatches(conversation, opts),
    [conversation, opts],
  )
  const highBlocked = high.length > 0 && !highOverride

  // Esc closes — same convention as the rename/delete modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !publishing) {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, publishing])

  // If the user picks profile-listed then loses their handle eligibility
  // (e.g. the modal re-renders with hasHandle=false), snap back to
  // unlisted so we don't submit an invalid combo.
  useEffect(() => {
    if (!hasHandle && visibility === 'profile-listed') {
      setVisibility('unlisted')
    }
  }, [hasHandle, visibility])

  // If the user redacts (via the "Redact all" CTA or by going back to
  // the editor) and the high tier clears, drop the override flag so
  // the Publish button returns to its normal style.
  useEffect(() => {
    if (high.length === 0 && highOverride) setHighOverride(false)
  }, [high.length, highOverride])

  async function handlePublish() {
    if (highBlocked || publishing) return
    setPublishing(true)
    setError(null)
    try {
      const snapshot = buildSnapshotFromEditor({ conversation, opts })
      const expires_at = computeExpiresAt({ kind: expires, custom: customExpiry })
      const res = await window.spoolShare.publish({
        snapshot,
        visibility,
        ...(expires_at !== undefined && { expires_at }),
        ...(existingSlug !== undefined && { override_slug: existingSlug }),
      })
      if (!res.ok) {
        if (res.status === 401) {
          setError('You need to sign in again.')
        } else if (res.status === 429) {
          setError('Too many publishes — try again in a few minutes.')
        } else {
          setError(res.error.detail ?? res.error.error ?? 'Publish failed.')
        }
        return
      }
      onPublished(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed.')
    } finally {
      setPublishing(false)
    }
  }

  const isRepublish = !!existingSlug

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
      data-testid="publish-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !publishing) onClose() }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm px-4 pt-[12vh] animate-in fade-in duration-150"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-3">
          <h2 id="publish-modal-title" className="text-base font-semibold text-warm-text dark:text-dark-text">
            {isRepublish ? 'Republish to spool.pro' : 'Publish to spool.pro'}
          </h2>
          <p className="mt-1 text-[12px] leading-snug text-warm-faint dark:text-dark-muted">
            {isRepublish
              ? 'A new version replaces the existing snapshot. The URL stays the same.'
              : 'A snapshot is uploaded to spool.pro. You can revoke it any time.'}
          </p>
        </div>

        {high.length > 0 && (
          <section
            data-testid="publish-modal-pii-high"
            className="mx-5 mb-3 rounded-md border border-[color:var(--color-status-error)]/40 bg-[color:var(--color-status-error)]/10 px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className="mt-0.5 flex-none text-[color:var(--color-status-error)]"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium text-warm-text dark:text-dark-text">
                  {high.length} credential-like value{high.length === 1 ? '' : 's'} would publish unredacted
                </p>
                <ul className="mt-1.5 space-y-1">
                  {high.slice(0, HIGH_ROW_LIMIT).map((m, i) => (
                    <li
                      key={`${m.turn_index}-${m.start}-${i}`}
                      className="text-[11.5px] text-warm-muted dark:text-dark-muted flex items-center gap-2"
                    >
                      <span className="font-medium">{m.label}</span>
                      <code className="font-mono text-[11px] px-1 rounded bg-warm-surface dark:bg-dark-surface">
                        {m.preview}
                      </code>
                    </li>
                  ))}
                  {high.length > HIGH_ROW_LIMIT && (
                    <li className="text-[11px] italic text-warm-faint dark:text-dark-muted">
                      +{high.length - HIGH_ROW_LIMIT} more
                    </li>
                  )}
                </ul>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {onRedactAll && (
                    <button
                      type="button"
                      onClick={onRedactAll}
                      data-testid="publish-modal-redact-all"
                      className="text-[11.5px] font-medium underline text-warm-text dark:text-dark-text hover:opacity-80"
                    >
                      Redact all
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-[11.5px] font-medium underline text-warm-text dark:text-dark-text hover:opacity-80"
                  >
                    Back to editor
                  </button>
                </div>
                {highBlocked && (
                  <p className="mt-2 text-[11.5px] text-warm-muted dark:text-dark-muted">
                    Click <span className="font-medium">Publish anyway</span> below to
                    confirm you intend to publish these values as-is.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {medium.length > 0 && (
          <section
            data-testid="publish-modal-pii-medium"
            className="mx-5 mb-3 rounded-md border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3 py-2"
          >
            <button
              type="button"
              onClick={() => setMediumOpen((v) => !v)}
              aria-expanded={mediumOpen}
              className="w-full flex items-center gap-1.5 text-[12px] text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
            >
              {mediumOpen
                ? <ChevronDown size={12} strokeWidth={1.8} aria-hidden />
                : <ChevronRight size={12} strokeWidth={1.8} aria-hidden />}
              <span>
                {medium.length} identity / location signal{medium.length === 1 ? '' : 's'} (email, phone, name, path)
              </span>
            </button>
            {mediumOpen && (
              <ul className="mt-1.5 space-y-1 pl-4">
                {medium.slice(0, 12).map((m, i) => (
                  <li
                    key={`${m.turn_index}-${m.start}-${i}`}
                    className="text-[11.5px] text-warm-muted dark:text-dark-muted flex items-center gap-2"
                  >
                    <span className="font-medium">{m.label}</span>
                    <code className="font-mono text-[11px] px-1 rounded bg-warm-bg dark:bg-dark-bg">
                      {m.preview}
                    </code>
                  </li>
                ))}
                {medium.length > 12 && (
                  <li className="text-[11px] italic text-warm-faint dark:text-dark-muted">
                    +{medium.length - 12} more
                  </li>
                )}
              </ul>
            )}
          </section>
        )}

        <fieldset disabled={publishing} className="px-5 pb-3">
          <legend className="text-[11px] font-medium tracking-[0.08em] uppercase text-warm-muted dark:text-dark-muted">
            Visibility
          </legend>
          <div className="mt-2 space-y-1.5">
            <label className="flex items-center gap-2 text-[12.5px] text-warm-text dark:text-dark-text cursor-pointer">
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'unlisted'}
                onChange={() => setVisibility('unlisted')}
              />
              Anyone with the link
            </label>
            <label
              className={`flex items-center gap-2 text-[12.5px] cursor-pointer ${
                hasHandle ? 'text-warm-text dark:text-dark-text' : 'text-warm-faint dark:text-dark-muted cursor-not-allowed'
              }`}
            >
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'profile-listed'}
                disabled={!hasHandle}
                onChange={() => setVisibility('profile-listed')}
              />
              Listed on my profile
              {!hasHandle && (
                <span className="text-[11px] italic">
                  (claim a handle in Settings first)
                </span>
              )}
            </label>
          </div>
        </fieldset>

        <fieldset disabled={publishing} className="px-5 pb-3">
          <legend className="text-[11px] font-medium tracking-[0.08em] uppercase text-warm-muted dark:text-dark-muted">
            Expires
          </legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {(['never', '7d', '30d', 'custom'] as const).map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 text-[12.5px] text-warm-text dark:text-dark-text cursor-pointer"
              >
                <input
                  type="radio"
                  name="expires"
                  checked={expires === opt}
                  onChange={() => setExpires(opt)}
                />
                {opt === 'never' ? 'Never' : opt === 'custom' ? 'Custom…' : opt === '7d' ? '7 days' : '30 days'}
              </label>
            ))}
          </div>
          {expires === 'custom' && (
            <input
              type="datetime-local"
              value={customExpiry}
              onChange={(e) => setCustomExpiry(e.target.value)}
              className="mt-2 h-8 px-2 rounded border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-[12.5px] text-warm-text dark:text-dark-text focus:outline-none focus:ring-1 focus:ring-warm-border2 dark:focus:ring-dark-border2"
            />
          )}
        </fieldset>

        {error && (
          <p
            role="alert"
            data-testid="publish-modal-error"
            className="mx-5 mb-3 text-[12px] text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-1 border-t border-warm-border/50 dark:border-dark-border/50">
          <button
            type="button"
            onClick={onClose}
            disabled={publishing}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          {highBlocked ? (
            <button
              type="button"
              data-testid="publish-modal-confirm-anyway"
              onClick={() => setHighOverride(true)}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-white bg-[color:var(--color-status-error)] hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Publish anyway
            </button>
          ) : (
            <button
              type="button"
              data-testid="publish-modal-submit"
              onClick={() => { void handlePublish() }}
              disabled={publishing}
              className={`inline-flex items-center gap-1.5 px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-white transition-opacity disabled:opacity-60 disabled:cursor-not-allowed ${
                high.length > 0
                  ? 'bg-[color:var(--color-status-error)] hover:opacity-90'
                  : 'bg-accent dark:bg-accent-dark hover:opacity-90'
              }`}
            >
              {publishing && <Loader2 size={12} strokeWidth={1.8} className="animate-spin" aria-hidden />}
              {publishing
                ? 'Publishing…'
                : high.length > 0
                  ? (isRepublish ? 'Republish anyway' : 'Publish anyway')
                  : (isRepublish ? 'Republish' : 'Publish')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
