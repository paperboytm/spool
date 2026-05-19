import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { SENSITIVE_KIND_LABEL } from '@spool-lab/redact'
import {
  computeExpiresAt,
  computeUnredactedMatches,
  truncatePreview,
  type ExpiryOption,
  type UnredactedMatch,
} from './publish-logic.js'
import type {
  PublishSuccess,
  ServerPiiHit,
  Snapshot,
  Visibility,
} from '../../../shared/share-publish.js'

type Props = {
  snapshot: Snapshot
  hasHandle: boolean
  /** Present when republishing an already-live share. */
  existingSlug?: string
  onClose: () => void
  onPublished: (r: PublishSuccess) => void
}

const PREVIEW_LIMIT = 6

/**
 * Publish-confirmation modal. Two gates run here:
 *
 *  1. Client-side PII rescan — `computeUnredactedMatches` runs the same
 *     detector the backend uses; if it finds anything not covered by a
 *     redaction span, the Publish button is disabled. Match content is
 *     never shown in full — only the kind label and a truncated
 *     preview, so we don't re-leak the very thing the user is about to
 *     redact.
 *
 *  2. Server-side rescan (authoritative). If `share-publish:publish`
 *     returns `error.error === 'UNPROCESSABLE'` with an `error.pii`
 *     array, we surface the server's matches in the same panel so the
 *     user can go back and redact them.
 */
export function PublishModal({
  snapshot,
  hasHandle,
  existingSlug,
  onClose,
  onPublished,
}: Props) {
  const [visibility, setVisibility] = useState<Visibility>('unlisted')
  const [expires, setExpires] = useState<ExpiryOption>('never')
  const [customExpiry, setCustomExpiry] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverPii, setServerPii] = useState<ServerPiiHit[] | null>(null)

  const clientMatches = useMemo(() => computeUnredactedMatches(snapshot), [snapshot])
  const serverMatches: UnredactedMatch[] = useMemo(() => {
    if (!serverPii) return []
    // Reconstruct truncated previews from the snapshot using the
    // server's offsets. We never trust the server to ship raw content.
    const byId = new Map(snapshot.conversation.turns.map((t) => [t.id, t.content] as const))
    return serverPii.map((h) => {
      const content = byId.get(h.turn_id) ?? ''
      return {
        turn_id: h.turn_id,
        kind: h.kind,
        label: SENSITIVE_KIND_LABEL[h.kind] ?? h.kind,
        preview: truncatePreview(content.slice(h.start, h.end)),
        start: h.start,
        end: h.end,
      }
    })
  }, [serverPii, snapshot])

  // Server matches take precedence — when they exist they reflect the
  // authoritative rejection. Otherwise show the client rescan.
  const surfaced = serverMatches.length > 0 ? serverMatches : clientMatches
  const piiBlocked = surfaced.length > 0

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

  async function handlePublish() {
    if (piiBlocked || publishing) return
    setPublishing(true)
    setError(null)
    setServerPii(null)
    try {
      const expires_at = computeExpiresAt({ kind: expires, custom: customExpiry })
      const res = await window.spoolShare.publish({
        snapshot,
        visibility,
        ...(expires_at !== undefined && { expires_at }),
        ...(existingSlug !== undefined && { override_slug: existingSlug }),
      })
      if (!res.ok) {
        if (res.error.error === 'UNPROCESSABLE' && Array.isArray(res.error.pii)) {
          setServerPii(res.error.pii)
          setError('The server found unredacted matches your editor missed. Please redact and retry.')
        } else if (res.status === 401) {
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
            {isRepublish ? 'Republish to spool.share' : 'Publish to spool.share'}
          </h2>
          <p className="mt-1 text-[12px] leading-snug text-warm-faint dark:text-dark-muted">
            {isRepublish
              ? 'A new version replaces the existing snapshot. The URL stays the same.'
              : 'A snapshot is uploaded to spool.share. You can revoke it any time.'}
          </p>
        </div>

        {piiBlocked && (
          <section
            data-testid="publish-modal-pii"
            className="mx-5 mb-3 rounded-md border border-[color:var(--color-status-warn)]/40 bg-[color:var(--color-status-warn)]/10 px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className="mt-0.5 flex-none text-[color:var(--color-status-warn)]"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium text-warm-text dark:text-dark-text">
                  {surfaced.length} unredacted match{surfaced.length === 1 ? '' : 'es'} detected
                </p>
                <ul className="mt-1.5 space-y-1">
                  {surfaced.slice(0, PREVIEW_LIMIT).map((m, i) => (
                    <li
                      key={`${m.turn_id}-${m.start}-${i}`}
                      className="text-[11.5px] text-warm-muted dark:text-dark-muted flex items-center gap-2"
                    >
                      <span className="font-medium">{m.label}</span>
                      <code className="font-mono text-[11px] px-1 rounded bg-warm-surface dark:bg-dark-surface">
                        {m.preview}
                      </code>
                    </li>
                  ))}
                  {surfaced.length > PREVIEW_LIMIT && (
                    <li className="text-[11px] italic text-warm-faint dark:text-dark-muted">
                      +{surfaced.length - PREVIEW_LIMIT} more
                    </li>
                  )}
                </ul>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-2 text-[11.5px] font-medium underline text-warm-text dark:text-dark-text hover:opacity-80"
                >
                  Back to editor to redact
                </button>
              </div>
            </div>
          </section>
        )}

        <fieldset disabled={piiBlocked || publishing} className="px-5 pb-3">
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

        <fieldset disabled={piiBlocked || publishing} className="px-5 pb-3">
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
          <button
            type="button"
            data-testid="publish-modal-submit"
            onClick={() => { void handlePublish() }}
            disabled={publishing || piiBlocked}
            className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {publishing && <Loader2 size={12} strokeWidth={1.8} className="animate-spin" aria-hidden />}
            {publishing ? 'Publishing…' : isRepublish ? 'Republish' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  )
}
