// /session/<sid> — the v2 hub session reader. Three layers (design §5):
// first screen (is this worth my time), timeline ↔ diff (process ↔
// outcome, two-way linked), and #r/<idx> deep links. Layout follows
// DESIGN.md: warm tokens, Geist Mono for record content, author-attributed
// metadata (the first-person voice belongs to the owner's library, not to
// a page someone else is reading).

import { useEffect, useMemo, useState } from 'react'

import { Footer, Header, Page } from '../components/Chrome'
import { DiffPane } from '../components/session/diff-pane'
import { FirstScreen } from '../components/session/first-screen'
import { Timeline } from '../components/session/timeline'
import { humanDateTime } from '../lib/dates'
import {
  fetchHubMeta,
  fetchHubView,
  makeRangeFetcher,
  type HubSessionMeta,
} from '../lib/hub-api'
import { deepLinkIndex, providerOf } from '../lib/session-page'
import { Tombstone } from './Tombstone'
import type { SessionViewV1 } from '@spool-lab/session-kit'

type PageState =
  | { phase: 'loading' }
  | { phase: 'not-found' }
  | { phase: 'withdrawn'; at: number }
  | { phase: 'error' }
  | { phase: 'ready'; meta: HubSessionMeta; view: SessionViewV1 | null }

export function SessionReader({ sid }: { sid: string }) {
  const [state, setState] = useState<PageState>({ phase: 'loading' })
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [highlightRecord, setHighlightRecord] = useState<number | null>(null)
  const [revealIndex, setRevealIndex] = useState<number | null>(null)

  const provider = providerOf(sid)
  const fetchRange = useMemo(() => makeRangeFetcher(sid), [sid])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const meta = await fetchHubMeta(sid)
      if (cancelled) return
      if (meta.kind === 'not-found') return setState({ phase: 'not-found' })
      if (meta.kind === 'withdrawn') return setState({ phase: 'withdrawn', at: meta.at })
      if (meta.kind === 'error') return setState({ phase: 'error' })
      const view = await fetchHubView(sid)
      if (cancelled) return
      setState({ phase: 'ready', meta: meta.meta, view })
    })()
    return () => { cancelled = true }
  }, [sid])

  // Deep link (#r/<idx>): reveal + highlight once the view is on screen.
  useEffect(() => {
    if (state.phase !== 'ready') return
    const index = deepLinkIndex(window.location.hash)
    if (index === null) return
    setRevealIndex(index)
    setHighlightRecord(index)
  }, [state.phase])

  if (state.phase === 'not-found') return <Tombstone reason="not-found" />

  if (state.phase === 'withdrawn') {
    return (
      <Page>
        <Header />
        <main className="sw-main center">
          <div className="sw-card tight" style={{ maxWidth: 560 }}>
            <div className="sw-rule" style={{ marginBottom: 22 }}>
              <span className="tag err">Session unavailable</span>
              <span className="line" />
            </div>
            <h1 className="sw-title">This session was withdrawn</h1>
            <p className="sw-lede">
              The author took it off the hub. The link stays dead until they share it again.
            </p>
            <p className="sw-mono" style={{ marginTop: 14, fontSize: 11.5, color: 'var(--muted)' }}>
              Withdrawn on {humanDateTime(state.at)}.
            </p>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  if (state.phase === 'error') {
    return (
      <Page>
        <Header />
        <main className="sw-main center">
          <div className="sw-card tight" style={{ maxWidth: 560 }}>
            <h1 className="sw-title">Could not load this session</h1>
            <p className="sw-lede">The hub did not answer. Try again in a moment.</p>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  const jumpToRecord = (index: number) => {
    setRevealIndex(index)
    setHighlightRecord(index)
  }

  const selectFile = (path: string) => {
    setOpenFile(path)
  }

  return (
    <Page>
      <Header />
      <main className="sw-main sw-session-main">
        {state.phase === 'loading' && <p className="sw-session-loading">Loading session…</p>}
        {state.phase === 'ready' && (
          <>
            <FirstScreen
              meta={state.meta}
              view={state.view}
              pageUrl={window.location.origin + window.location.pathname}
              onOpenFile={selectFile}
              onJumpToRecord={jumpToRecord}
            />
            {state.view
              ? (
                <div className="sw-session-layers">
                  <Timeline
                    view={state.view}
                    provider={provider}
                    fetchRange={fetchRange}
                    highlightIndex={highlightRecord}
                    revealIndex={revealIndex}
                    onSelectFile={selectFile}
                  />
                  <DiffPane
                    view={state.view}
                    provider={provider}
                    fetchRange={fetchRange}
                    openFile={openFile}
                    highlightRecord={highlightRecord}
                    onSelectFile={selectFile}
                    onJumpToRecord={jumpToRecord}
                  />
                </div>
              )
              : (
                <p className="sw-session-loading">
                  This share has no view object — the timeline can&apos;t render, but the resume
                  command above still works.
                </p>
              )}
          </>
        )}
      </main>
      <Footer />
    </Page>
  )
}
