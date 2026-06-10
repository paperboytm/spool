import { Component, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  PAPERS,
  SnapshotReader,
  TEMPLATE_RATIO,
  decodeSnapshot,
} from '@spool/share-kit'
import type { Snapshot } from '@spool/share-kit'

import { Footer, Header, Page } from '../components/Chrome'
import { fetchSnapshot, type SnapshotFetchResult } from '../lib/api'
import { reportMailto } from '../lib/mailto'
import { Tombstone } from './Tombstone'

const DEFAULT_PAPER_HEX = '#FAF7F0'
const DEFAULT_NATURAL_WIDTH = 720

function paperHexFor(snapshot: Snapshot | null): string {
  if (!snapshot) return DEFAULT_PAPER_HEX
  const { opts } = decodeSnapshot(snapshot)
  return PAPERS.find((p) => p.id === opts.paper)?.tokens.paper ?? DEFAULT_PAPER_HEX
}

function naturalWidthFor(snapshot: Snapshot | null): number {
  if (!snapshot) return DEFAULT_NATURAL_WIDTH
  const { opts } = decodeSnapshot(snapshot)
  return TEMPLATE_RATIO[opts.template].w
}

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
  | { kind: 'gone'; reason: 'revoked'; at: number }
  | { kind: 'not-found' }
  | { kind: 'error' }

function fromFetch(result: SnapshotFetchResult): Exclude<State, { kind: 'loading' }> {
  if (result.kind === 'ok') return { kind: 'ok', snapshot: result.snapshot }
  return result
}

export function Reader({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  // Pull the active snapshot (or null) into a single value so the hooks
  // below can run unconditionally — Rules of Hooks require the same
  // call order on every render, regardless of state.kind.
  const activeSnapshot = state.kind === 'ok' ? state.snapshot : null
  const paperHex = useMemo(() => paperHexFor(activeSnapshot), [activeSnapshot])
  const naturalWidth = useMemo(() => naturalWidthFor(activeSnapshot), [activeSnapshot])

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
      <Page>
        <Header />
        <main className="sw-main center" aria-busy="true">
          <div className="sw-loading">
            <span className="sw-spin sw-spin-anim" />
            Loading share
          </div>
        </main>
        <Footer report reportHref={reportMailto(id)} />
      </Page>
    )
  }
  if (state.kind === 'gone') return <Tombstone reason={state.reason} at={state.at} />
  if (state.kind === 'not-found') return <Tombstone reason="not-found" />
  if (state.kind === 'error') return <Tombstone reason="not-found" />

  return (
    <Page>
      <Header />
      <div className="reader-canvas">
        <div
          className="reader-paper"
          style={{ width: naturalWidth, background: paperHex }}
        >
          <SnapshotErrorBoundary>
            <SnapshotReader snapshot={state.snapshot} />
          </SnapshotErrorBoundary>
        </div>
      </div>
      <Footer report reportHref={reportMailto(id)} />
    </Page>
  )
}
