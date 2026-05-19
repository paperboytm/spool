import { useEffect, useState } from 'react'

import { fetchProfile, type ProfileFetchResult, type ProfileResponse } from '../lib/api'
import { Tombstone } from './Tombstone'

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; profile: ProfileResponse }
  | { kind: 'not-found' }
  | { kind: 'error' }

function fromFetch(r: ProfileFetchResult): Exclude<State, { kind: 'loading' }> {
  if (r.kind === 'ok') return { kind: 'ok', profile: r.profile }
  return r
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString()
  } catch {
    return ''
  }
}

export function Profile({ handle }: { handle: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetchProfile(handle).then((r) => {
      if (cancelled) return
      const next = fromFetch(r)
      setState(next)
      if (next.kind === 'ok') {
        const display = next.profile.name ?? `@${next.profile.handle}`
        document.title = `${display} · spool.pro`
      } else {
        document.title = 'Profile not found · spool.pro'
      }
    })
    return () => {
      cancelled = true
    }
  }, [handle])

  if (state.kind === 'loading') {
    return (
      <main className="reader-loading" aria-busy="true">
        <div className="reader-loading-card">Loading…</div>
      </main>
    )
  }
  if (state.kind === 'not-found') {
    return (
      <main className="profile-page">
        <div className="profile-card">
          <h1>Profile not found</h1>
          <p>Nothing here. Check the handle, or ask the author for a fresh link.</p>
        </div>
      </main>
    )
  }
  if (state.kind === 'error') return <Tombstone reason="not-found" />

  const { profile } = state
  return (
    <main className="profile-page">
      <header className="profile-header">
        {profile.avatar_url ? (
          <img className="profile-avatar" src={profile.avatar_url} alt="" />
        ) : null}
        <div className="profile-identity">
          {profile.name && <h1 className="profile-name">{profile.name}</h1>}
          <p className="profile-handle">@{profile.handle}</p>
        </div>
      </header>
      <section className="profile-shares">
        {profile.shares.length === 0 ? (
          <p className="profile-empty">Nothing published yet.</p>
        ) : (
          <ul className="profile-share-list">
            {profile.shares.map((s) => (
              <li key={s.id}>
                <a className="profile-share-link" href={`/s/${encodeURIComponent(s.id)}`}>
                  <span className="profile-share-title">{s.title}</span>
                  <span className="profile-share-meta">{formatDate(s.published_at)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
