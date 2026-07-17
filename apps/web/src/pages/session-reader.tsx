// /session/<sid> — the v2 hub session reader. Curated publications render
// through share-kit's TimelineBody; legacy sessions fall back to the desktop
// MessageList fed by the same session-kit parsers.

import { useEffect, useMemo, useState } from 'react'
import type { SessionViewV1 } from '@spool-lab/session-kit'
import type { SpoolDocument } from '@spool/share-kit'

import { Footer, Header, Page } from '../components/Chrome'
import { SessionWorkbench } from '../components/session/workbench'
import { humanDateTime } from '../lib/dates'
import {
  fetchHubMeta,
  fetchHubSpoolFile,
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

export interface LoadedSessionContent {
  view: SessionViewV1 | null
  spoolDocument: SpoolDocument | null
  records: HubRecordLine[]
}

interface SessionContentDeps {
  fetchView: (sid: string) => Promise<SessionViewV1 | null>
  fetchSpoolFile: (sid: string) => Promise<SpoolDocument | null>
  makeRangeFetcher: (sid: string) => RangeFetcher
}

interface SessionContentLoadOptions {
  isCancelled?: () => boolean
  onRecordProgress?: (loaded: number, total: number) => void
  /** Preserve record-addressed URLs by using the legacy MessageList, whose
   * record-to-message mapping is exact. Curated turns cannot be mapped back
   * to raw tool records reliably. */
  preferRawRecords?: boolean
}

const defaultSessionContentDeps: SessionContentDeps = {
  fetchView: fetchHubView,
  fetchSpoolFile: fetchHubSpoolFile,
  makeRangeFetcher,
}

/**
 * Prefer the curated publication document. Raw records are the legacy
 * rendering fallback and are only downloaded when no valid .spool artifact
 * is attached; diffs can still fetch their sparse ranges later.
 */
export async function loadSessionContent(
  sid: string,
  meta: HubSessionMeta,
  deps: SessionContentDeps = defaultSessionContentDeps,
  options: SessionContentLoadOptions = {},
): Promise<LoadedSessionContent | null> {
  const isCancelled = options.isCancelled ?? (() => false)
  const viewPromise = deps.fetchView(sid)
  // The view request is speculative and may outlive a cancelled spool/raw
  // load. Attach a rejection handler now; awaiting the original promise
  // below still preserves the normal error path.
  void viewPromise.catch(() => undefined)

  if (meta.spoolFileOid != null && !options.preferRawRecords) {
    const spoolDocument = await deps.fetchSpoolFile(sid)
    if (isCancelled()) return null
    if (spoolDocument !== null) {
      const view = await viewPromise
      return isCancelled() ? null : { view, spoolDocument, records: [] }
    }
  }

  const fetchRange = deps.makeRangeFetcher(sid)
  const records: HubRecordLine[] = []
  const total = meta.count
  options.onRecordProgress?.(0, total)
  while (records.length < total) {
    const from = records.length
    const page = await fetchRecordsExact(fetchRange, from, Math.min(from + FETCH_PAGE, total))
    if (isCancelled()) return null
    records.push(...page)
    options.onRecordProgress?.(records.length, total)
  }

  const view = await viewPromise
  return isCancelled() ? null : { view, spoolDocument: null, records }
}

type PageState =
  | { phase: 'loading'; loaded: number; total: number | null }
  | { phase: 'not-found' }
  | { phase: 'withdrawn'; at: number }
  | { phase: 'error' }
  | {
      phase: 'ready'
      meta: HubSessionMeta
      view: SessionViewV1 | null
      spoolDocument: SpoolDocument | null
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
  const isDark = useIsDark()

  const provider = providerOf(sid)
  const initialRecordIndex = useMemo(
    () => typeof window === 'undefined' ? null : deepLinkIndex(window.location.hash),
    [sid],
  )

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading', loaded: 0, total: null })
    void (async () => {
      const meta = await fetchHubMeta(sid)
      if (cancelled) return
      if (meta.kind === 'not-found') return setState({ phase: 'not-found' })
      if (meta.kind === 'withdrawn') return setState({ phase: 'withdrawn', at: meta.at })
      if (meta.kind === 'error') return setState({ phase: 'error' })

      try {
        const content = await loadSessionContent(sid, meta.meta, defaultSessionContentDeps, {
          isCancelled: () => cancelled,
          onRecordProgress: (loaded, total) => {
            if (!cancelled) setState({ phase: 'loading', loaded, total })
          },
          preferRawRecords: initialRecordIndex !== null,
        })
        if (cancelled || content === null) return
        setState({ phase: 'ready', meta: meta.meta, ...content })
      } catch {
        if (!cancelled) setState({ phase: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [initialRecordIndex, sid])

  const conversation = useMemo(
    () => (state.phase === 'ready' ? parseHubConversation(provider, state.records) : null),
    [state, provider],
  )

  if (state.phase === 'not-found') return <Tombstone reason="not-found" />

  if (state.phase === 'withdrawn') {
    return (
      <Page>
        <Header sticky />
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
          <div className="w-full max-w-[560px] rounded-[10px] border border-[var(--border)] bg-[var(--card)] p-8 shadow-[var(--shadow-card)]">
            <div className="mb-6 flex items-center gap-3">
              <span className="rounded border border-[#C95A4F] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C95A4F] [[data-theme=dark]_&]:border-[#D67259] [[data-theme=dark]_&]:text-[#D67259]">
                Session unavailable
              </span>
              <span className="h-px flex-1 bg-[var(--border)]" aria-hidden="true" />
            </div>
            <h1 className="m-0 text-xl font-semibold leading-8 tracking-[-0.01em] text-[var(--text)]">
              This session was withdrawn
            </h1>
            <p className="mb-0 mt-3 text-[13px] leading-5 text-[var(--muted)]">
              The author took it off the hub. The link stays dead until they share it again.
            </p>
            <p className="mb-0 mt-4 font-mono text-[11px] text-[var(--muted)]">
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
        <Header sticky />
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
          <div className="w-full max-w-[560px] rounded-[10px] border border-[var(--border)] bg-[var(--card)] p-8 shadow-[var(--shadow-card)]">
            <h1 className="m-0 text-xl font-semibold leading-8 tracking-[-0.01em] text-[var(--text)]">
              Could not load this session
            </h1>
            <p className="mb-0 mt-3 text-[13px] leading-5 text-[var(--muted)]">
              The hub did not answer. Try again in a moment.
            </p>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  if (state.phase === 'ready' && conversation !== null) {
    return (
      <Page>
        <Header sticky />
        <SessionWorkbench
          key={sid}
          meta={state.meta}
          view={state.view}
          provider={provider}
          conversation={conversation}
          spoolDocument={state.spoolDocument}
          isDark={isDark}
          initialRecordIndex={initialRecordIndex}
        />
        <Footer />
      </Page>
    )
  }

  return (
    <Page>
      <Header sticky />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        {state.phase === 'loading' && (
          <p className="m-0 text-center text-[13px] text-[var(--muted)]">
            {state.total === null
              ? 'Loading session…'
              : `Loading records ${state.loaded}/${state.total}…`}
          </p>
        )}
      </main>
      <Footer />
    </Page>
  )
}
