// /session/<sid> — the v2 hub session reader. Curated publications render
// through share-kit's TimelineBody; legacy sessions fall back to the desktop
// MessageList fed by the same session-kit parsers.

import type { SessionViewV1 } from '@spool-lab/session-kit'
import type { SpoolDocument } from '@spool/share-kit'
import { useEffect, useMemo, useState } from 'react'

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
import { useQualifiedRead } from '../lib/qualified-read'
import { parseHubConversation } from '../lib/session-messages'
import { deepLinkIndex, providerOf } from '../lib/session-page'
import { deriveSessionRoute, projectSessionRouteToSpool } from '../lib/session-route'
import { Tombstone } from './Tombstone'

const FETCH_PAGE = 500
/** Curated publications already contain their readable timeline. Raw records
 * only enrich the optional Route with machine evidence, so keep that
 * best-effort request bounded instead of re-downloading arbitrarily large
 * Sessions in the background. */
export const MAX_ROUTE_EVIDENCE_RECORDS = 2_000

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
  signal?: AbortSignal
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

async function loadRawRecords(
  sid: string,
  total: number,
  makeFetcher: (sid: string, signal?: AbortSignal) => RangeFetcher,
  options: Pick<SessionContentLoadOptions, 'isCancelled' | 'onRecordProgress' | 'signal'> = {},
): Promise<HubRecordLine[] | null> {
  const isCancelled = options.isCancelled ?? (() => false)
  if (isCancelled()) return null
  const fetchRange = makeFetcher(sid, options.signal)
  const records: HubRecordLine[] = []
  options.onRecordProgress?.(0, total)
  while (records.length < total) {
    const from = records.length
    const page = await fetchRecordsExact(fetchRange, from, Math.min(from + FETCH_PAGE, total))
    if (isCancelled()) return null
    records.push(...page)
    options.onRecordProgress?.(records.length, total)
  }
  return records
}

/**
 * Best-effort evidence load for the route map on curated .spool pages.
 * It is deliberately separate from loadSessionContent: the publication can
 * render as soon as its compact document arrives, and a raw-record failure
 * only suppresses the optional map instead of failing the reader.
 */
export async function loadSessionRouteRecords(
  sid: string,
  total: number,
  deps: Pick<SessionContentDeps, 'makeRangeFetcher'> = defaultSessionContentDeps,
  options: Pick<SessionContentLoadOptions, 'isCancelled' | 'signal'> = {},
): Promise<HubRecordLine[] | null> {
  if (total > MAX_ROUTE_EVIDENCE_RECORDS) return null
  try {
    return await loadRawRecords(sid, total, deps.makeRangeFetcher, options)
  } catch {
    return null
  }
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

  const records = await loadRawRecords(sid, meta.count, deps.makeRangeFetcher, options)
  if (records === null) return null

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
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])
  return isDark
}

export function SessionReader({ sid }: { sid: string }) {
  const [state, setState] = useState<PageState>({ phase: 'loading', loaded: 0, total: null })
  const [routeRecords, setRouteRecords] = useState<{
    sid: string
    records: HubRecordLine[]
  } | null>(null)
  const isDark = useIsDark()

  const provider = providerOf(sid)
  const initialRecordIndex = useMemo(
    () => (typeof window === 'undefined' ? null : deepLinkIndex(window.location.hash)),
    [sid],
  )
  useQualifiedRead(sid, state.phase === 'ready' && state.meta.visibility === 'public')

  useEffect(() => {
    let cancelled = false
    const abortController = new AbortController()
    setRouteRecords(null)
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
          signal: abortController.signal,
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
    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [initialRecordIndex, sid])

  const routeRecordTotal =
    state.phase === 'ready' &&
    state.meta.sid === sid &&
    state.spoolDocument !== null &&
    state.records.length === 0 &&
    state.meta.count <= MAX_ROUTE_EVIDENCE_RECORDS
      ? state.meta.count
      : null

  useEffect(() => {
    if (routeRecordTotal === null || routeRecordTotal === 0) return
    let cancelled = false
    const abortController = new AbortController()
    void loadSessionRouteRecords(sid, routeRecordTotal, defaultSessionContentDeps, {
      isCancelled: () => cancelled,
      signal: abortController.signal,
    }).then((records) => {
      if (!cancelled && records !== null) setRouteRecords({ sid, records })
    })
    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [routeRecordTotal, sid])

  const effectiveRecords =
    state.phase === 'ready' && state.records.length === 0 && routeRecords?.sid === sid
      ? routeRecords.records
      : state.phase === 'ready'
        ? state.records
        : []

  const conversation = useMemo(
    () => (state.phase === 'ready' ? parseHubConversation(provider, effectiveRecords) : null),
    [effectiveRecords, state.phase, provider],
  )

  const route = useMemo(() => {
    if (state.phase !== 'ready') return null
    const rawRoute = deriveSessionRoute(effectiveRecords)
    return state.spoolDocument === null
      ? rawRoute
      : projectSessionRouteToSpool(rawRoute, state.spoolDocument)
  }, [effectiveRecords, state])

  if (state.phase === 'not-found') return <Tombstone reason="not-found" />

  if (state.phase === 'withdrawn') {
    return (
      <Page>
        <Header sticky />
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
          <div className="w-full max-w-[560px] rounded-[10px] border border-[var(--border)] bg-[var(--card)] p-8 shadow-[var(--shadow-card)]">
            <div className="mb-6 flex items-center gap-3">
              <span className="rounded border border-[var(--sp-error)] px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-[var(--sp-error)] uppercase">
                Session unavailable
              </span>
              <span className="h-px flex-1 bg-[var(--border)]" aria-hidden="true" />
            </div>
            <h1 className="m-0 text-xl leading-8 font-semibold tracking-[-0.01em] text-[var(--text)]">
              This session was withdrawn
            </h1>
            <p className="mt-3 mb-0 text-[13px] leading-5 text-[var(--muted)]">
              The author took it off the hub. The link stays dead until they share it again.
            </p>
            <p className="mt-4 mb-0 font-mono text-[11px] text-[var(--muted)]">
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
            <h1 className="m-0 text-xl leading-8 font-semibold tracking-[-0.01em] text-[var(--text)]">
              Could not load this session
            </h1>
            <p className="mt-3 mb-0 text-[13px] leading-5 text-[var(--muted)]">
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
          route={route}
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
