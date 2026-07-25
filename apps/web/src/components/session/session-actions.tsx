import type { DiscoverySessionSocialResponse } from '@spool-lab/session-kit'
import { Button } from '@spool-lab/ui'
import { GitFork, Star } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  fetchSessionSocial,
  updateSessionStar,
  type SessionSocialResult,
} from '../../lib/session-social'
import { ResumeMenu } from './resume-menu'

import '../../styles/session-actions.css'

type SocialState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: DiscoverySessionSocialResponse }
  | { kind: 'error' }
  | { kind: 'hidden' }

export function SessionActions({
  sid,
  providerLabel,
  publicSession,
  resumable,
}: {
  sid: string
  providerLabel: string
  publicSession: boolean
  resumable: boolean
}) {
  const [social, setSocial] = useState<SocialState>(
    publicSession ? { kind: 'loading' } : { kind: 'hidden' },
  )
  const [socialAttempt, setSocialAttempt] = useState(0)
  const [starBusy, setStarBusy] = useState(false)
  const [mutationError, setMutationError] = useState(false)

  useEffect(() => {
    if (!publicSession) {
      setSocial({ kind: 'hidden' })
      return
    }
    const controller = new AbortController()
    setSocial({ kind: 'loading' })
    void fetchSessionSocial(sid, undefined, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setSocial(socialState(result))
    })
    return () => controller.abort()
  }, [publicSession, sid, socialAttempt])

  async function toggleStar() {
    if (starBusy || social.kind !== 'ready') return
    setStarBusy(true)
    setMutationError(false)
    const intent = social.data.viewerStarred ? 'unstar' : 'star'
    const result = await updateSessionStar(sid, intent)
    setStarBusy(false)
    if (result.kind === 'unauthenticated') {
      const next = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`)
      return
    }
    if (result.kind === 'not-found') {
      setSocial({ kind: 'hidden' })
      return
    }
    if (result.kind !== 'ok') {
      setMutationError(true)
      return
    }
    setSocial({ kind: 'ready', data: result.data })
  }

  function retrySocial() {
    setMutationError(false)
    if (social.kind === 'error') {
      setSocial({ kind: 'loading' })
      setSocialAttempt((attempt) => attempt + 1)
      return
    }
    void toggleStar()
  }

  const socialVisible = publicSession && social.kind !== 'hidden'
  const counts = social.kind === 'ready' ? social.data : null
  const starred = counts?.viewerStarred ?? false
  const socialError = social.kind === 'error' || mutationError

  if (!socialVisible && !resumable) return null

  return (
    <div className="session-actions" aria-label="Session actions">
      {socialVisible ? (
        <div className="session-action-group">
          <Button
            type="button"
            className={`session-star-button ${starred ? 'is-starred' : ''}`}
            variant="outline"
            loading={starBusy}
            loadingLabel={starred ? 'Unstarring…' : 'Starring…'}
            disabled={social.kind !== 'ready'}
            aria-pressed={starred}
            title={
              social.kind === 'error'
                ? 'Star data unavailable. Try again.'
                : mutationError
                  ? 'Star update failed. Try again.'
                  : starred
                    ? 'Remove your star'
                    : 'Star this public Session'
            }
            onClick={() => void toggleStar()}
          >
            <Star fill={starred ? 'currentColor' : 'none'} aria-hidden="true" />
            {starred ? 'Starred' : 'Star'}
          </Button>
          <SocialCount
            value={counts?.starCount ?? null}
            singular="star"
            plural="stars"
            unavailable={social.kind === 'error'}
          />
        </div>
      ) : null}

      {resumable ? (
        <div
          className={`session-action-group session-resume-action ${
            socialVisible ? 'has-social-count' : ''
          }`}
        >
          <ResumeMenu sid={sid} providerLabel={providerLabel} />
          {socialVisible ? (
            <SocialCount
              value={counts?.forkCount ?? null}
              singular="published fork"
              plural="published forks"
              unavailable={social.kind === 'error'}
              title="Public Sessions resumed from this source and later shared"
              fork
            />
          ) : null}
        </div>
      ) : null}

      {socialError ? (
        <div className="session-social-error" role="alert">
          <span>
            {social.kind === 'error' ? 'Couldn’t load Star data.' : 'Couldn’t update Star.'}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={retrySocial}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function socialState(result: SessionSocialResult): SocialState {
  if (result.kind === 'ok') return { kind: 'ready', data: result.data }
  if (result.kind === 'not-found') return { kind: 'hidden' }
  return { kind: 'error' }
}

function SocialCount({
  value,
  singular,
  plural,
  unavailable,
  title,
  fork = false,
}: {
  value: number | null
  singular: string
  plural: string
  unavailable: boolean
  title?: string
  fork?: boolean
}) {
  const formatted = value === null ? '—' : value.toLocaleString('en-US')
  const label =
    value === null
      ? unavailable
        ? `${plural} unavailable`
        : `Loading ${plural}`
      : `${formatted} ${value === 1 ? singular : plural}`

  return (
    <span className="session-social-count" aria-label={label} title={title ?? label}>
      {fork ? <GitFork size={13} strokeWidth={1.7} aria-hidden="true" /> : null}
      {formatted}
    </span>
  )
}
