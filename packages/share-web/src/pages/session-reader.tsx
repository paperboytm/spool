// /session/<sid> — the v2 hub session reader. First screen (note vs
// machine evidence) stays hub-specific; the conversation itself renders
// through @spool-lab/session-view — the same components the desktop app
// uses to open a session — fed by the same session-kit parsers. Diff pane
// recomputes per-file changes client-side. #r/<idx> deep links and hunk
// clicks resolve record indices to conversation messages.

import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageList, type MessageListHandle } from '@spool-lab/session-view'
import type { SessionViewV1 } from '@spool-lab/session-kit'

import { Footer, Header, Page } from '../components/Chrome'
import { DiffPane } from '../components/session/diff-pane'
import { FirstScreen } from '../components/session/first-screen'
import { humanDateTime } from '../lib/dates'
import {
  fetchHubMeta,
  fetchHubView,
  fetchRecordsExact,
  makeRangeFetcher,
  type HubRecordLine,
  type HubSessionMeta,
  type RangeFetcher,
} from '../lib/hub-api'
import { deepLinkIndex, providerOf } from '../lib/session-page'
import { parseHubConversation } from '../lib/session-messages'
import { Tombstone } from './Tombstone'

const FETCH_PAGE = 500

type PageState =
  | { phase: 'loading'; loaded: number; total: number | null }
  | { phase: 'not-found' }
  | { phase: 'withdrawn'; at: number }
  | { phase: 'error' }
  | {
      phase: 'ready'
      meta: HubSessionMeta
      view: SessionViewV1 | null
      records: HubRecordLine[]
    }

/** html[data-theme] is the page-wide theme contract (see Chrome.tsx). */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark',
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

export function SessionReader({ sid }: { sid: string }) {
  const [state, setState] = useState<PageState>({ phase: 'loading', loaded: 0, total: null })
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null)
  const [highlightRecord, setHighlightRecord] = useState<number | null>(null)
  const listRef = useRef<MessageListHandle>(null)
  const isDark = useIsDark()

  const provider = providerOf(sid)

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

      // The conversation renders like the desktop's session detail, which
      // needs the full message list — fetch every record, page by page,
      // with visible progress.
      const fetchRange = makeRangeFetcher(sid)
      const records: HubRecordLine[] = []
      const total = meta.meta.count
      try {
        while (records.length < total) {
          const from = records.length
          const page = await fetchRecordsExact(fetchRange, from, Math.min(from + FETCH_PAGE, total))
          if (cancelled) return
          records.push(...page)
          setState({ phase: 'loading', loaded: records.length, total })
        }
      } catch {
        if (!cancelled) setState({ phase: 'error' })
        return
      }
      if (cancelled) return
      setState({ phase: 'ready', meta: meta.meta, view, records })
    })()
    return () => { cancelled = true }
  }, [sid])

  const conversation = useMemo(
    () => (state.phase === 'ready' ? parseHubConversation(provider, state.records) : null),
    [state, provider],
  )

  // Serve the diff pane from the records already in memory — no second
  // trip over the network.
  const localFetchRange: RangeFetcher = useMemo(() => {
    const records = state.phase === 'ready' ? state.records : []
    return (from, to) => Promise.resolve(records.slice(from, to))
  }, [state])

  const jumpToRecord = (index: number) => {
    setHighlightRecord(index)
    const messageId = conversation?.recordToMessageId.get(index)
    if (messageId === undefined) return
    setTargetMessageId(messageId)
    listRef.current?.scrollToMessageId(messageId)
  }

  // Deep link (#r/<idx>): resolve once the conversation is on screen.
  useEffect(() => {
    if (state.phase !== 'ready' || conversation === null) return
    const index = deepLinkIndex(window.location.hash)
    if (index === null) return
    const messageId = conversation.recordToMessageId.get(index)
    if (messageId === undefined) return
    setHighlightRecord(index)
    setTargetMessageId(messageId)
    // Virtuoso mounts with initialTopMostItemIndex via targetMessageId,
    // but if the list is already mounted, scroll imperatively too.
    requestAnimationFrame(() => listRef.current?.scrollToMessageId(messageId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, conversation])

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

  return (
    <Page>
      <Header />
      <main className="sw-main sw-session-main">
        {state.phase === 'loading' && (
          <p className="sw-session-loading">
            {state.total === null
              ? 'Loading session…'
              : `Loading records ${state.loaded}/${state.total}…`}
          </p>
        )}
        {state.phase === 'ready' && (
          <>
            <FirstScreen
              meta={state.meta}
              view={state.view}
              onOpenFile={setOpenFile}
              onJumpToRecord={jumpToRecord}
            />
            <div className="sw-session-layers">
              <section className="sw-session-conversation">
                {conversation && conversation.messages.length > 0
                  ? (
                    <MessageList
                      key={sid}
                      ref={listRef}
                      messages={conversation.messages}
                      isDark={isDark}
                      targetMessageId={targetMessageId}
                      showTargetHighlight={targetMessageId !== null}
                    />
                  )
                  : <p className="sw-session-loading">No renderable messages in this session.</p>}
              </section>
              {state.view && (
                <DiffPane
                  view={state.view}
                  provider={provider}
                  fetchRange={localFetchRange}
                  openFile={openFile}
                  highlightRecord={highlightRecord}
                  onSelectFile={setOpenFile}
                  onJumpToRecord={jumpToRecord}
                />
              )}
            </div>
          </>
        )}
      </main>
      <Footer />
    </Page>
  )
}
