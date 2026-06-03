import { Component, type ReactNode, useEffect, useState } from 'react'
import { SnapshotReader } from '@spool/share-kit'
import type { Snapshot } from '@spool/share-kit'

import { fetchSnapshot, type SnapshotFetchResult } from '../lib/api'
import { reportMailto } from '../lib/mailto'
import { Tombstone } from './Tombstone'

// Defensive boundary around SnapshotReader. Server-validated JSON in
// theory cannot reach us with shape mismatches, but a future template
// regression or a content-driven render edge case shouldn't blank the
// page silently — show the same tombstone the user would see for a
// 404 / network error.
class SnapshotErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: Error): void {
    // Logs to the browser console only; we don't have a remote logger
    // in v0.5 share-web.
    console.error('Reader render crash:', error)
  }
  override render(): ReactNode {
    if (this.state.failed) return <Tombstone reason="not-found" />
    return this.props.children
  }
}

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; snapshot: Snapshot }
  | { kind: 'gone'; reason: 'revoked' | 'expired'; at: number }
  | { kind: 'not-found' }
  | { kind: 'error' }

function fromFetch(result: SnapshotFetchResult): Exclude<State, { kind: 'loading' }> {
  if (result.kind === 'ok') return { kind: 'ok', snapshot: result.snapshot }
  return result
}

export function Reader({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetchSnapshot(id).then((result) => {
      if (cancelled) return
      const next = fromFetch(result)
      setState(next)
      if (next.kind === 'ok') {
        document.title = `${next.snapshot.conversation.title} · spool.pro`
      } else if (next.kind === 'gone' || next.kind === 'not-found') {
        document.title = 'Unavailable · spool.pro'
      }
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (state.kind === 'loading') {
    return (
      <main className="reader-loading" aria-busy="true">
        <div className="reader-loading-card">Loading…</div>
      </main>
    )
  }
  if (state.kind === 'gone') return <Tombstone reason={state.reason} at={state.at} />
  if (state.kind === 'not-found') return <Tombstone reason="not-found" />
  if (state.kind === 'error') return <Tombstone reason="not-found" />

  return (
    <>
      <SnapshotErrorBoundary>
        <SnapshotReader snapshot={state.snapshot} />
      </SnapshotErrorBoundary>
      <footer className="reader-footer">
        <span>
          <a href={reportMailto(id)} rel="nofollow">
            Report this share
          </a>
        </span>
        <span aria-hidden="true"> · </span>
        <span>
          <a href="/terms">Terms</a>
        </span>
        <span aria-hidden="true"> · </span>
        <span>
          <a href="/privacy">Privacy</a>
        </span>
      </footer>
    </>
  )
}
