// /session/<sid> — the v2 hub session reader. Curated publications render
// through share-kit's TimelineBody; legacy sessions fall back to the desktop
// MessageList fed by the same session-kit parsers.

import { parseSummaryFrontMatter, type SessionViewV1 } from '@spool-lab/session-kit'
import type { SpoolDocument } from '@spool/share-kit'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Footer, Header, Page } from '../components/Chrome'
import { SessionWorkbench, type SessionHistoryState } from '../components/session/workbench'
import { SessionLanguageToolbar } from '../components/SessionLanguageToggle'
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
import { useQualifiedRead } from '../lib/qualified-read'
import { parseHubConversation } from '../lib/session-messages'
import { deepLinkIndex, providerOf } from '../lib/session-page'
import { Tombstone } from './Tombstone'

/**
 * The Hub permits 500 records per read, but the reader deliberately asks for
 * smaller pages. That gives long legacy Sessions useful, monotonic progress
 * instead of holding the UI at zero while a multi-megabyte response arrives.
 */
export const SESSION_RECORD_PAGE_SIZE = 100

function hasBilingualSessionCopy(summaryMd: string | null): boolean {
  const summary = parseSummaryFrontMatter(summaryMd)
  return Boolean(
    (summary.titles?.en && summary.titles.zh) || (summary.summaries?.en && summary.summaries.zh),
  )
}

export interface LoadedSessionContent {
  view: SessionViewV1 | null
  spoolDocument: SpoolDocument | null
  records: HubRecordLine[]
}

interface SessionContentDeps {
  fetchView: (sid: string) => Promise<SessionViewV1 | null>
  fetchSpoolFile: (sid: string) => Promise<SpoolDocument | null>
  makeRangeFetcher: (sid: string, signal?: AbortSignal) => RangeFetcher
}

interface SessionContentLoadOptions {
  isCancelled?: () => boolean
  initialRecords?: readonly HubRecordLine[]
  signal?: AbortSignal
  onRecordProgress?: (loaded: number, total: number, records: readonly HubRecordLine[]) => void
}

const defaultSessionContentDeps: SessionContentDeps = {
  fetchView: fetchHubView,
  fetchSpoolFile: fetchHubSpoolFile,
  makeRangeFetcher,
}

async function loadRawRecords(
  sid: string,
  total: number,
  makeFetcher: (sid: string, signal?: AbortSignal) => RangeFetcher,
  options: Pick<
    SessionContentLoadOptions,
    'initialRecords' | 'isCancelled' | 'onRecordProgress' | 'signal'
  > = {},
): Promise<HubRecordLine[] | null> {
  const isCancelled = options.isCancelled ?? (() => false)
  if (isCancelled()) return null
  const fetchRange = makeFetcher(sid, options.signal)
  const records: HubRecordLine[] = [...(options.initialRecords ?? [])]
  options.onRecordProgress?.(records.length, total, records)
  while (records.length < total) {
    const from = records.length
    const page = await fetchRecordsExact(
      fetchRange,
      from,
      Math.min(from + SESSION_RECORD_PAGE_SIZE, total),
    )
    if (isCancelled()) return null
    records.push(...page)
    options.onRecordProgress?.(records.length, total, records)
  }
  return records
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

  if (meta.spoolFileOid != null) {
    const spoolDocument = await deps.fetchSpoolFile(sid)
    if (isCancelled()) return null
    const view = await viewPromise
    return isCancelled() ? null : { view, spoolDocument, records: [] }
  }

  const records = await loadRawRecords(sid, meta.count, deps.makeRangeFetcher, options)
  if (records === null) return null

  const view = await viewPromise
  return isCancelled() ? null : { view, spoolDocument: null, records }
}

type PageState =
  | { phase: 'loading' }
  | { phase: 'not-found' }
  | { phase: 'auth-required' }
  | { phase: 'withdrawn'; at: number }
  | { phase: 'error' }
  | {
      phase: 'ready'
      meta: HubSessionMeta
      view: SessionViewV1 | null
      viewResolved: boolean
      spoolDocument: SpoolDocument | null
      records: HubRecordLine[]
      history: SessionHistoryState
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
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])
  return isDark
}

export function SessionReader({ sid }: { sid: string }) {
  const [state, setState] = useState<PageState>({ phase: 'loading' })
  const isDark = useIsDark()

  const provider = providerOf(sid)
  const initialRecordIndex = useMemo(
    () => (typeof window === 'undefined' ? null : deepLinkIndex(window.location.hash)),
    [sid],
  )
  useQualifiedRead(sid, state.phase === 'ready' && state.meta.visibility === 'public')

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    void (async () => {
      const meta = await fetchHubMeta(sid)
      if (cancelled) return
      if (meta.kind === 'not-found') return setState({ phase: 'not-found' })
      if (meta.kind === 'auth-required') return setState({ phase: 'auth-required' })
      if (meta.kind === 'withdrawn') return setState({ phase: 'withdrawn', at: meta.at })
      if (meta.kind === 'error') return setState({ phase: 'error' })

      const shouldLoadPublication = meta.meta.spoolFileOid != null
      setState({
        phase: 'ready',
        meta: meta.meta,
        view: null,
        viewResolved: false,
        spoolDocument: null,
        records: [],
        history: shouldLoadPublication
          ? { phase: 'loading', source: 'publication', loaded: 0, total: meta.meta.count }
          : initialRecordIndex !== null
            ? { phase: 'loading', source: 'records', loaded: 0, total: meta.meta.count }
            : { phase: 'idle', total: meta.meta.count },
      })

      // The machine-derived view is evidence, not a prerequisite for the
      // first screen. Let Summary, title metadata, and author attribution
      // render while this independent immutable object arrives.
      const view = await fetchHubView(sid)
      if (cancelled) return
      setState((current) =>
        current.phase === 'ready' && current.meta.sid === meta.meta.sid
          ? { ...current, view, viewResolved: true }
          : current,
      )
    })()
    return () => {
      cancelled = true
    }
  }, [initialRecordIndex, sid])

  const activeHistorySource =
    state.phase === 'ready' && state.history.phase === 'loading' ? state.history.source : null

  useEffect(() => {
    if (activeHistorySource === null || state.phase !== 'ready') return

    let cancelled = false
    const abortController = new AbortController()
    const { meta } = state
    const startingRecords = state.records

    void (async () => {
      try {
        if (activeHistorySource === 'publication') {
          const spoolDocument = await fetchHubSpoolFile(sid)
          if (cancelled) return
          if (spoolDocument !== null) {
            setState((current) =>
              current.phase === 'ready' && current.meta.sid === meta.sid
                ? {
                    ...current,
                    spoolDocument,
                    history: { phase: 'ready', total: meta.count },
                  }
                : current,
            )
            return
          }

          // A declared publication attachment is the visibility boundary.
          // Never fall back to raw records when it is unavailable: retry the
          // curated artifact instead.
          setState((current) =>
            current.phase === 'ready' && current.meta.sid === meta.sid
              ? {
                  ...current,
                  history: {
                    phase: 'error',
                    source: 'publication',
                    loaded: 0,
                    total: meta.count,
                  },
                }
              : current,
          )
          return
        }

        const records = await loadRawRecords(
          sid,
          meta.count,
          defaultSessionContentDeps.makeRangeFetcher,
          {
            initialRecords: startingRecords,
            isCancelled: () => cancelled,
            signal: abortController.signal,
            onRecordProgress: (loaded, total, nextRecords) => {
              if (cancelled) return
              setState((current) =>
                current.phase === 'ready' && current.meta.sid === meta.sid
                  ? {
                      ...current,
                      records: [...nextRecords],
                      history: { phase: 'loading', source: 'records', loaded, total },
                    }
                  : current,
              )
            },
          },
        )
        if (cancelled || records === null) return
        setState((current) =>
          current.phase === 'ready' && current.meta.sid === meta.sid
            ? {
                ...current,
                records,
                history: { phase: 'ready', total: meta.count },
              }
            : current,
        )
      } catch {
        if (cancelled) return
        setState((current) =>
          current.phase === 'ready' && current.meta.sid === meta.sid
            ? {
                ...current,
                history: {
                  phase: 'error',
                  source: activeHistorySource,
                  loaded: current.records.length,
                  total: meta.count,
                },
              }
            : current,
        )
      }
    })()

    return () => {
      cancelled = true
      abortController.abort()
    }
    // Progress updates intentionally do not restart this effect: only the
    // active source (curated publication or raw records) identifies a load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHistorySource, sid])

  const loadHistory = useCallback(() => {
    setState((current) =>
      current.phase === 'ready' &&
      (current.history.phase === 'idle' || current.history.phase === 'error')
        ? {
            ...current,
            history: {
              phase: 'loading',
              source: current.meta.spoolFileOid == null ? 'records' : 'publication',
              loaded: current.records.length,
              total: current.meta.count,
            },
          }
        : current,
    )
  }, [])

  const readyRecords = state.phase === 'ready' ? state.records : null

  const conversation = useMemo(
    () =>
      readyRecords === null || readyRecords.length === 0
        ? null
        : parseHubConversation(provider, readyRecords),
    [provider, readyRecords],
  )

  if (state.phase === 'not-found') return <Tombstone reason="not-found" />

  if (state.phase === 'auth-required') {
    const next = `/session/${encodeURIComponent(sid)}`
    return (
      <Page>
        <Header sticky />
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
          <div className="rounded-card border-border bg-background shadow-card w-full max-w-[560px] border p-6 md:p-8">
            <div className="mb-6 flex items-center gap-3">
              <span className="rounded-badge border-accent text-label text-accent border px-2 py-1 font-semibold tracking-[0.08em] uppercase">
                Team Session
              </span>
              <span className="bg-border h-px flex-1" aria-hidden="true" />
            </div>
            <h1 className="text-foreground m-0 text-xl leading-8 font-semibold tracking-[-0.01em]">
              Sign in to check access
            </h1>
            <p className="text-ui text-muted mt-3 mb-6 leading-5">
              This Session is visible only to current members of its Team. Sign in with your Spool
              account to continue.
            </p>
            <a
              className="rounded-control bg-accent-fill text-ui text-on-accent inline-flex min-h-11 items-center justify-center px-4 font-semibold no-underline hover:opacity-90"
              href={`/sign-in?next=${encodeURIComponent(next)}`}
            >
              Sign in
            </a>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  if (state.phase === 'withdrawn') {
    return (
      <Page>
        <Header sticky />
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
          <div className="rounded-card border-border bg-background shadow-card w-full max-w-[560px] border p-8">
            <div className="mb-6 flex items-center gap-3">
              <span className="rounded-badge border-status-error text-label text-status-error border px-2 py-1 font-semibold tracking-[0.08em] uppercase">
                Session unavailable
              </span>
              <span className="bg-border h-px flex-1" aria-hidden="true" />
            </div>
            <h1 className="text-foreground m-0 text-xl leading-8 font-semibold tracking-[-0.01em]">
              This session was withdrawn
            </h1>
            <p className="text-ui text-muted mt-3 mb-0 leading-5">
              The author took it off the hub. The link stays dead until they share it again.
            </p>
            <p className="text-meta text-muted mt-4 mb-0 font-mono">
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
          <div className="rounded-card border-border bg-background shadow-card w-full max-w-[560px] border p-8">
            <h1 className="text-foreground m-0 text-xl leading-8 font-semibold tracking-[-0.01em]">
              Could not load this session
            </h1>
            <p className="text-ui text-muted mt-3 mb-0 leading-5">
              The hub did not answer. Try again in a moment.
            </p>
          </div>
        </main>
        <Footer />
      </Page>
    )
  }

  if (state.phase === 'ready') {
    return (
      <Page>
        <Header sticky />
        {hasBilingualSessionCopy(state.meta.summaryMd) ? <SessionLanguageToolbar /> : null}
        <SessionWorkbench
          key={sid}
          meta={state.meta}
          view={state.view}
          viewResolved={state.viewResolved}
          provider={provider}
          conversation={conversation}
          spoolDocument={state.spoolDocument}
          isDark={isDark}
          initialRecordIndex={initialRecordIndex}
          history={state.history}
          onLoadHistory={loadHistory}
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
          <div className="w-full max-w-[720px]" aria-label="Loading session">
            <div className="rounded-badge bg-surface-2 mb-4 h-3 w-32" />
            <div className="rounded-badge bg-surface-2 mb-3 h-8 w-4/5" />
            <div className="rounded-card bg-surface h-24" />
          </div>
        )}
      </main>
      <Footer />
    </Page>
  )
}
