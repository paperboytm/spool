import { ipcMain } from 'electron'
import {
  getDB,
  getByDraftId as getCachedByDraftId,
  listAll as listCachedPublished,
  markRevoked as markCachedRevoked,
  replaceAll as replaceCachedPublished,
  upsertMany as upsertCachedPublished,
  type PublishedShareCacheItem,
} from '@spool-lab/core'
import { authedFetch } from '../share/api-client.js'
import { clearToken } from '../auth/session-store.js'
import type {
  PublishRequestBody,
  PublishResult,
  PublishErrorBody,
  MySharesResponse,
  HandleCheckResponse,
  HandleClaimResponse,
  ScheduleDeleteResponse,
  SetVisibilityResult,
  Visibility,
} from '../../shared/share-publish.js'

async function readBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function registerSharePublishIpc(): void {
  ipcMain.handle('share-publish:publish', async (_e, body: PublishRequestBody): Promise<PublishResult> => {
    const r = await authedFetch('/api/publish', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const json = await readBody(r)
    if (!r.ok) {
      if (r.status === 401) clearToken()
      const error: PublishErrorBody = {
        error: typeof json['error'] === 'string' ? (json['error'] as string) : `HTTP_${r.status}`,
      }
      if (typeof json['detail'] === 'string') error.detail = json['detail'] as string
      if (json['issues'] !== undefined) error.issues = json['issues']
      return { ok: false, status: r.status, error }
    }
    const id = String(json['id'] ?? '')
    const url = String(json['url'] ?? '')
    const version = Number(json['version'] ?? 1)

    // Write the new (or refreshed) row into the local cache so the
    // editor's on-mount draft lookup and the Shares list reflect this
    // publish without waiting for the next /api/me/shares poll.
    // visibility comes straight from the request, title from the
    // snapshot — the backend echoes neither in the publish response.
    const now = Date.now()
    const item: PublishedShareCacheItem = {
      id,
      title: body.snapshot.conversation.title,
      visibility: body.visibility,
      version,
      published_at: now,
      revoked_at: null,
      draft_id: body.draft_id,
      client_request_id: body.idempotency_key,
      updated_at: now,
    }
    try {
      upsertCachedPublished(getDB(), [item])
    } catch (err) {
      // Cache write failures are non-fatal — the next myShares poll
      // will reconcile. Log so we notice systemic issues.
      console.warn('[share-publish] cache upsert after publish failed:', err)
    }

    // Cast: PublishedShareCacheItem stores `visibility` as a plain
    // string for forward-compat with future visibility tokens we
    // haven't taught core about yet, while the IPC wire `PublishedRow`
    // enforces the Visibility enum. The body.visibility we just
    // composed `item` from IS a Visibility, so the narrowing is safe;
    // we add the cast at the boundary rather than re-typing the cache
    // module to keep core import-free of the share-publish wire.
    return { ok: true, data: { id, url, version }, row: { ...item, visibility: body.visibility } }
  })

  ipcMain.handle('share-publish:revoke', async (_e, id: string): Promise<{ ok: true }> => {
    const r = await authedFetch(`/api/revoke/${encodeURIComponent(id)}`, { method: 'POST' })
    if (!r.ok) {
      if (r.status === 401) clearToken()
      throw new Error(`revoke ${r.status}`)
    }
    // Flip the cache's revoked_at so the editor and Shares list
    // immediately surface the unpublish. Same non-fatal posture as
    // the publish path above.
    try {
      markCachedRevoked(getDB(), id, Date.now())
    } catch (err) {
      console.warn('[share-publish] cache mark revoked after revoke failed:', err)
    }
    return { ok: true }
  })

  ipcMain.handle(
    'share-publish:set-visibility',
    async (_e, id: string, visibility: Visibility): Promise<SetVisibilityResult> => {
      const r = await authedFetch(`/api/me/shares/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      })
      const json = await readBody(r)
      if (!r.ok) {
        if (r.status === 401) clearToken()
        const error: PublishErrorBody = {
          error: typeof json['error'] === 'string' ? (json['error'] as string) : `HTTP_${r.status}`,
        }
        if (typeof json['detail'] === 'string') error.detail = json['detail'] as string
        return { ok: false, status: r.status, error }
      }
      // No local cache write here — the renderer follows up with a
      // myShares refresh (guarded by its mutation generation), which
      // reconciles the cache through the normal replaceAll path.
      return { ok: true, visibility }
    },
  )

  ipcMain.handle(
    'share-publish:get-published-by-draft',
    (_e, draftId: string): PublishedShareCacheItem | null => {
      return getCachedByDraftId(getDB(), draftId)
    },
  )

  ipcMain.handle('share-publish:my-shares', async (): Promise<MySharesResponse> => {
    const r = await authedFetch('/api/me/shares')
    if (!r.ok) {
      if (r.status === 401) clearToken()
      throw new Error(`me/shares ${r.status}`)
    }
    return (await r.json()) as MySharesResponse
  })

  ipcMain.handle('share-publish:claim-handle', async (_e, handle: string): Promise<HandleClaimResponse> => {
    const r = await authedFetch('/api/handles/claim', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    })
    if (!r.ok) {
      if (r.status === 401) clearToken()
      const body = await readBody(r)
      const detail = typeof body['detail'] === 'string' ? body['detail'] : `claim ${r.status}`
      throw new Error(detail)
    }
    return (await r.json()) as HandleClaimResponse
  })

  ipcMain.handle('share-publish:check-handle', async (_e, handle: string): Promise<HandleCheckResponse> => {
    const r = await authedFetch(`/api/handles/check?h=${encodeURIComponent(handle)}`)
    if (!r.ok) {
      if (r.status === 401) clearToken()
      throw new Error(`check ${r.status}`)
    }
    return (await r.json()) as HandleCheckResponse
  })

  ipcMain.handle('share-publish:cached-published', (): PublishedShareCacheItem[] => {
    return listCachedPublished(getDB())
  })

  ipcMain.handle(
    'share-publish:cache-published',
    (_e, items: PublishedShareCacheItem[]): { ok: true } => {
      replaceCachedPublished(getDB(), items)
      return { ok: true }
    },
  )

  ipcMain.handle('share-publish:schedule-delete', async (): Promise<ScheduleDeleteResponse> => {
    const r = await authedFetch('/api/me/delete', { method: 'POST' })
    if (!r.ok) {
      if (r.status === 401) clearToken()
      throw new Error(`schedule-delete ${r.status}`)
    }
    return (await r.json()) as ScheduleDeleteResponse
  })

  ipcMain.handle('share-publish:cancel-delete', async (): Promise<{ ok: true }> => {
    const r = await authedFetch('/api/me/delete', { method: 'DELETE' })
    if (!r.ok) {
      if (r.status === 401) clearToken()
      throw new Error(`cancel-delete ${r.status}`)
    }
    return { ok: true }
  })
}
