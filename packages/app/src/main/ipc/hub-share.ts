import { ipcMain, net } from 'electron'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { getDB, getSessionWithMessages } from '@spool-lab/core'
import {
  HubClient,
  HubHttpError,
  buildNotePrefill,
  buildWorkspaceCard,
  chunkUploads,
  detectWorkspaceRoot,
  prepareShare,
  scanRecordsForSecrets,
  type PreparedShare,
  type WorkspaceCard,
} from '@spool-lab/cli/hub'

import { loadToken } from '../auth/session-store.js'
import { backendUrl } from '../share/backend-url.js'
import type {
  HubSharePrepareResult,
  HubSharePublishResult,
} from '../../shared/hub-share.js'

// One-click share to the hub: the same pipeline `spool share` runs, driven
// from the app. Auth is the app's existing sign-in session — the hub
// accepts session bearers directly, so there is no separate login. The
// prepare step computes everything locally (nothing leaves the machine)
// so the dialog can show the redact findings before the user decides.

interface PreparedEntry {
  prepared: PreparedShare
  card: WorkspaceCard | null
}

const preparedCache = new Map<string, PreparedEntry>()

export interface HubShareIpcDeps {
  fetchFn?: typeof globalThis.fetch
  loadTokenFn?: () => string | null
  resolveTarget?: (sessionUuid: string) => {
    provider: 'claude' | 'codex'
    sessionUuid: string
    filePath: string
    cwd: string | null
  }
}

// Electron's net.fetch honours the OS proxy + trust store (same rationale
// as share/api-client.ts).
const defaultFetch: typeof globalThis.fetch = (url, init) =>
  net.fetch(url as string, init as RequestInit)

function resolveTargetFromIndex(sessionUuid: string) {
  const db = getDB(true)
  const found = getSessionWithMessages(db, sessionUuid)
  if (!found) throw new Error(`Session not found in the local index: ${sessionUuid}`)
  const { session } = found
  if (session.source !== 'claude' && session.source !== 'codex') {
    throw new Error(`Sharing ${session.source} sessions is not supported yet (claude and codex only)`)
  }
  if (session.filePath.startsWith('spool:')) {
    throw new Error('This session has no provider file on disk yet')
  }
  return {
    provider: session.source,
    sessionUuid: session.sessionUuid,
    filePath: session.filePath,
    cwd: session.cwd,
  }
}

async function prepareEntry(
  sessionUuid: string,
  deps: HubShareIpcDeps,
): Promise<PreparedEntry> {
  const resolveTarget = deps.resolveTarget ?? resolveTargetFromIndex
  const target = resolveTarget(sessionUuid)
  const workspaceRoot = detectWorkspaceRoot(target.cwd ?? process.cwd())
  const card = buildWorkspaceCard(workspaceRoot)
  const prepared = await prepareShare({
    provider: target.provider,
    sessionUuid: target.sessionUuid,
    jsonl: readFileSync(target.filePath, 'utf8'),
    workspaceRoot,
    homeDir: homedir(),
  })
  const entry: PreparedEntry = { prepared, card }
  preparedCache.set(sessionUuid, entry)
  return entry
}

export function registerHubShareIpc(deps: HubShareIpcDeps = {}): void {
  ipcMain.handle('hub-share:prepare', async (_e, args: { sessionUuid: string }): Promise<HubSharePrepareResult> => {
    try {
      const { prepared, card } = await prepareEntry(args.sessionUuid, deps)
      const secrets = scanRecordsForSecrets(prepared.records.map((record) => record.data))
      return {
        ok: true,
        prepared: {
          sid: prepared.sid,
          count: prepared.count,
          files: prepared.view.diffstat.files,
          adds: prepared.view.diffstat.adds,
          dels: prepared.view.diffstat.dels,
          secrets: { total: secrets.total, high: secrets.high, byKind: secrets.byKind },
          notePrefill: buildNotePrefill({ view: prepared.view, card, count: prepared.count }),
        },
      }
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }
  })

  ipcMain.handle('hub-share:publish', async (_e, args: { sessionUuid: string; note: string }): Promise<HubSharePublishResult> => {
    try {
      const token = (deps.loadTokenFn ?? loadToken)()
      if (!token) return { ok: false, error: 'UNAUTHENTICATED' }

      const entry = preparedCache.get(args.sessionUuid) ?? await prepareEntry(args.sessionUuid, deps)
      const { prepared, card } = entry

      const client = new HubClient({
        hubUrl: backendUrl(),
        token,
        fetch: deps.fetchFn ?? defaultFetch,
      })

      const head = {
        root: prepared.root,
        count: prepared.count,
        manifest: prepared.manifest,
        sig: null,
        cardJson: card === null ? null : JSON.stringify(card),
        noteMd: args.note.trim() === '' ? null : args.note,
        lineageJson: prepared.lineageJson,
        viewOid: prepared.viewOid,
      }

      const { missing } = await client.pushSession(prepared.sid, head)
      const missingSet = new Set(missing)
      const uploads = [
        ...prepared.records.map((record) => ({ oid: record.oid, data: record.data })),
        { oid: prepared.viewOid, data: prepared.viewData },
      ].filter((object) => missingSet.has(object.oid))

      for (const batch of chunkUploads(uploads)) {
        await client.uploadObjects(batch)
      }

      const { url } = await client.commitSessionHead(prepared.sid, head)
      preparedCache.delete(args.sessionUuid)
      return { ok: true, url }
    } catch (cause) {
      if (cause instanceof HubHttpError && cause.status === 401) {
        return { ok: false, error: 'UNAUTHENTICATED' }
      }
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    }
  })
}
