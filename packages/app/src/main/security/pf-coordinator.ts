// Single source of truth for the Privacy Filter download lifecycle.
// Wraps downloadModel + state checks behind a subscribe()-driven API
// so the renderer's `evt-pf-state` always agrees with what the user
// can act on. ModelHost spawn/unload lands in PR 5c.

import { Effect } from 'effect'
import { downloadModel, type DownloadProgress } from './model-download.js'
import { MODEL_MANIFEST, manifestTotalBytes } from './model-manifest.js'
import { pfInstallStatus } from './model-state.js'

export type PfPhase =
  | 'not-installed'
  | 'downloading'
  | 'installed'
  | 'failed'

export interface PfDownloadState {
  phase: PfPhase
  bytesDownloaded: number
  bytesTotal: number
  error?: string
}

export interface PfCoordinator {
  getState(): PfDownloadState
  startDownload(): Promise<void>
  cancelDownload(): void
  subscribe(handler: (s: PfDownloadState) => void): () => void
  dispose(): void
}

export interface PfCoordinatorDeps {
  modelDir: string
  fetch?: typeof globalThis.fetch
  /** Effect runner that carries the main-process observability
   *  layer. Defaults to bare `Effect.runPromise` for tests; main
   *  passes `runWithObservability` so `pf.coordinator.download`
   *  spans land in the same OTel pipeline as the rest of Spool. */
  run?: <A, E>(eff: Effect.Effect<A, E>) => Promise<A>
}

export function makePfCoordinator(deps: PfCoordinatorDeps): PfCoordinator {
  const subscribers = new Set<(s: PfDownloadState) => void>()
  const totalBytes = manifestTotalBytes(MODEL_MANIFEST)
  let abortController: AbortController | null = null
  let state = initialState(deps.modelDir)
  const run = (deps.run ?? Effect.runPromise) as <A, E>(eff: Effect.Effect<A, E>) => Promise<A>

  function publish(): void {
    for (const fn of subscribers) {
      try { fn(state) } catch (err) { console.error('[pf] subscriber threw:', err) }
    }
  }

  async function startDownload(): Promise<void> {
    if (state.phase === 'downloading' || state.phase === 'installed') return
    abortController = new AbortController()
    state = {
      phase: 'downloading',
      bytesDownloaded: state.bytesDownloaded,
      bytesTotal: state.bytesTotal,
    }
    publish()
    await run(
      Effect.tryPromise({
        try: () => downloadModel({
          modelDir: deps.modelDir,
          manifest: MODEL_MANIFEST,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          signal: abortController!.signal,
          onProgress: (p: DownloadProgress) => {
            state = {
              phase: 'downloading',
              bytesDownloaded: p.bytesDownloaded,
              bytesTotal: p.bytesTotal,
            }
            publish()
          },
        }),
        catch: (err) => err,
      }).pipe(
        Effect.tap(() => Effect.sync(() => {
          state = { phase: 'installed', bytesDownloaded: totalBytes, bytesTotal: totalBytes }
        })),
        Effect.tap(() => Effect.annotateCurrentSpan('pf.download.outcome', 'installed')),
        Effect.catchAll((err) => Effect.sync(() => {
          const aborted = (err as { name?: string } | undefined)?.name === 'AbortError'
          if (aborted) {
            state = initialState(deps.modelDir)
          } else {
            state = {
              phase: 'failed',
              bytesDownloaded: state.bytesDownloaded,
              bytesTotal: state.bytesTotal,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }).pipe(Effect.tap(() => Effect.annotateCurrentSpan(
          'pf.download.outcome',
          (err as { name?: string } | undefined)?.name === 'AbortError' ? 'cancelled' : 'failed',
        )))),
        Effect.ensuring(Effect.sync(() => {
          abortController = null
          publish()
        })),
        Effect.withSpan('pf.coordinator.download', {
          attributes: {
            'pf.download.total_bytes': totalBytes,
            'pf.download.files': MODEL_MANIFEST.files.length,
          },
        }),
      ),
    )
  }

  function cancelDownload(): void {
    if (state.phase !== 'downloading') return
    abortController?.abort()
  }

  function subscribe(handler: (s: PfDownloadState) => void): () => void {
    subscribers.add(handler)
    return () => subscribers.delete(handler)
  }

  return {
    getState: () => state,
    startDownload,
    cancelDownload,
    subscribe,
    dispose: () => {
      abortController?.abort()
      subscribers.clear()
    },
  }
}

function initialState(modelDir: string): PfDownloadState {
  const total = manifestTotalBytes(MODEL_MANIFEST)
  const installed = pfInstallStatus(modelDir, MODEL_MANIFEST)
  switch (installed.status) {
    case 'installed':
      return { phase: 'installed', bytesDownloaded: total, bytesTotal: total }
    case 'partial':
      return { phase: 'not-installed', bytesDownloaded: installed.bytesPresent, bytesTotal: installed.bytesTotal }
    case 'not-installed':
      return { phase: 'not-installed', bytesDownloaded: 0, bytesTotal: total }
  }
}
