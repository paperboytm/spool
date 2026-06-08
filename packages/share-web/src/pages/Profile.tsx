import { useEffect, useState } from 'react'

import {
  Avatar,
  Footer,
  Header,
  Page,
} from '../components/Chrome'
import { fetchProfile, type ProfileFetchResult, type ProfileResponse } from '../lib/api'
import { humanDate } from '../lib/dates'

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; profile: ProfileResponse }
  | { kind: 'not-found' }
  | { kind: 'error' }

function fromFetch(r: ProfileFetchResult): Exclude<State, { kind: 'loading' }> {
  if (r.kind === 'ok') return { kind: 'ok', profile: r.profile }
  return r
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
      <Page>
        <Header />
        <main className="sw-main">
          <div className="sw-card w-600">
            <div className="sw-identity">
              <span className="sw-skel" style={{ width: 54, height: 54, borderRadius: '50%' }} />
              <div className="body">
                <span className="sw-skel" style={{ width: 140, height: 18, marginBottom: 8 }} />
                <span className="sw-skel" style={{ width: 80, height: 13 }} />
              </div>
            </div>
            <div className="sw-divider" style={{ margin: '24px 0 18px' }} />
            <ul className="sw-list">
              {[0, 1, 2].map((i) => (
                <li key={i} className="sw-share" style={{ justifyContent: 'space-between' }}>
                  <span className="sw-skel" style={{ width: `${60 - i * 8}%`, height: 14 }} />
                  <span className="sw-skel" style={{ width: 70, height: 11 }} />
                </li>
              ))}
            </ul>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  if (state.kind === 'not-found' || state.kind === 'error') {
    return (
      <Page>
        <Header />
        <main className="sw-main">
          <div className="sw-card tight w-600">
            <div className="sw-rule" style={{ marginBottom: 22 }}>
              <span className="tag muted">Profile not found</span>
              <span className="line" />
            </div>
            <h1 className="sw-title">Nothing here</h1>
            <p className="sw-lede">Check the handle, or ask the author for a fresh link.</p>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  const { profile } = state
  return (
    <Page>
      <Header />
      <main className="sw-main">
        <div className="sw-card w-600">
          <div className="sw-identity">
            <Avatar src={profile.avatar_url} name={profile.name} size={54} />
            <div className="body">
              {profile.name && <h1 className="name">{profile.name}</h1>}
              <p className="handle">@{profile.handle}</p>
            </div>
          </div>
          <div className="sw-divider" style={{ margin: '24px 0 18px' }} />
          <h2 className="sw-section-label" style={{ marginBottom: 14 }}>
            Published
            {profile.shares.length > 0 && (
              <span className="count">{profile.shares.length}</span>
            )}
          </h2>
          {profile.shares.length === 0 ? (
            <p className="sw-empty">Nothing published yet.</p>
          ) : (
            <ul className="sw-list">
              {profile.shares.map((s) => (
                <li key={s.id} className="sw-share">
                  <a
                    className="sw-share-link"
                    href={`/s/${encodeURIComponent(s.id)}`}
                  >
                    <span className="sw-share-title" title={s.title}>
                      {s.title}
                    </span>
                    <span className="sw-share-date">{humanDate(s.published_at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <Footer />
    </Page>
  )
}
