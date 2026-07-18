import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

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
import { getDB, getSessionWithMessages } from '@spool-lab/core'
import { detectSensitiveSpans, maskValueByKind } from '@spool-lab/redact'
import {
  canonicalizeRecord,
  parseClaudeSessionText,
  parseCodexSessionLines,
} from '@spool-lab/session-kit'
// Type-only: share-kit's runtime bundle needs a DOM at import time and
// must never be required from the main process. The document is
// constructed as plain JSON matching the .spool v2 shape; sanitization
// runs through @spool-lab/redact directly (the same detectors share-kit's
// redact pipeline wraps).
import type { SpoolDocument } from '@spool/share-kit'
import { ipcMain, net } from 'electron'

import type { HubSharePrepareResult, HubSharePublishResult } from '../../shared/hub-share.js'
import { loadToken } from '../auth/session-store.js'
import { backendUrl } from '../share/backend-url.js'

// One-click share to the hub: the same pipeline `spool share` runs, driven
// from the app. Auth is the app's existing sign-in session — the hub
// accepts session bearers directly, so there is no separate login. The
// prepare step computes everything locally (nothing leaves the machine)
// so the dialog can show the redact findings before the user decides.

interface PreparedEntry {
  prepared: PreparedShare
  card: WorkspaceCard | null
  /** Auto-built .spool document (sanitized) attached to the share. */
  spoolFile: { oid: string; data: string } | null
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
    throw new Error(
      `Sharing ${session.source} sessions is not supported yet (claude and codex only)`,
    )
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

async function prepareEntry(sessionUuid: string, deps: HubShareIpcDeps): Promise<PreparedEntry> {
  const resolveTarget = deps.resolveTarget ?? resolveTargetFromIndex
  const target = resolveTarget(sessionUuid)
  const workspaceRoot = detectWorkspaceRoot(target.cwd ?? process.cwd())
  const card = buildWorkspaceCard(workspaceRoot)
  const jsonl = readFileSync(target.filePath, 'utf8')
  const prepared = await prepareShare({
    provider: target.provider,
    sessionUuid: target.sessionUuid,
    jsonl,
    workspaceRoot,
    homeDir: homedir(),
  })
  const spoolFile = await buildAttachedSpoolFile(target, jsonl)
  const entry: PreparedEntry = { prepared, card, spoolFile }
  preparedCache.set(sessionUuid, entry)
  return entry
}

/**
 * Every desktop share carries a .spool document automatically — the
 * curated publication artifact (design: records are the raw stream, the
 * .spool is the publication). Built deterministically from the parsed
 * conversation with the default template and `sanitize: true`, so the
 * attached document bakes redactions in. Degrades to null (share still
 * succeeds) when the session yields no renderable turns.
 */
async function buildAttachedSpoolFile(
  target: { provider: 'claude' | 'codex'; sessionUuid: string; filePath: string },
  jsonl: string,
): Promise<{ oid: string; data: string } | null> {
  const result =
    target.provider === 'claude'
      ? parseClaudeSessionText(jsonl, target.filePath)
      : parseCodexSessionLines(jsonl.split('\n'), target.filePath)
  if (result.kind !== 'parsed') return null

  const turns = result.session.messages
    .filter(
      (message) =>
        !message.isSidechain &&
        (message.role === 'user' || message.role === 'assistant') &&
        message.contentText.trim() !== '',
    )
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      body: sanitizeBody(message.contentText),
      timestamp: message.timestamp,
    }))
  if (turns.length === 0) return null

  const words = turns.reduce(
    (total, turn) => total + turn.body.split(/\s+/).filter(Boolean).length,
    0,
  )
  const doc: SpoolDocument = {
    version: 2,
    exportedAt: new Date().toISOString(),
    conversation: {
      source: target.provider === 'claude' ? 'claude-code' : 'codex',
      sourceLabel: target.provider === 'claude' ? 'Claude Code' : 'Codex CLI',
      origin: { kind: 'agent-session', agent: target.provider, sessionUuid: target.sessionUuid },
      // The title derives from the first prompt, which can carry the same
      // secrets as the bodies — sanitize it too.
      title: sanitizeBody(result.session.title),
      shareUrl: null,
      createdAt: result.session.startedAt,
      wordCount: words,
      readMin: Math.max(1, Math.ceil(words / 200)),
      turns,
    },
    // Mirror of share-kit's DEFAULT_OPTS (redactExclude dropped — the
    // bodies above are already sanitized, matching sanitize: true).
    opts: {
      template: 'chat',
      paper: 'snow',
      typeface: 'inter',
      colorway: 'amber',
      accentHex: '#C85A00',
      density: 'compact',
      redact: true,
      showGaps: true,
      showMasthead: true,
      showColophon: true,
      hideEmptyTurns: true,
    },
  }
  return canonicalizeRecord(JSON.stringify(doc))
}

/** Bake redactions into a turn body — the main-process equivalent of
 *  share-kit's sanitize pass (same detectors, default everything-on
 *  policy). Longest-first replacement so overlapping literals mask
 *  cleanly. */
function sanitizeBody(body: string): string {
  const matches = detectSensitiveSpans(body)
  if (matches.length === 0) return body
  const literals = [...new Set(matches.map((match) => match.value))].sort(
    (a, b) => b.length - a.length,
  )
  let out = body
  for (const literal of literals) {
    const kind = matches.find((match) => match.value === literal)?.kind
    if (!kind) continue
    out = out.split(literal).join(maskValueByKind(kind, literal))
  }
  return out
}

export function registerHubShareIpc(deps: HubShareIpcDeps = {}): void {
  ipcMain.handle(
    'hub-share:prepare',
    async (_e, args: { sessionUuid: string }): Promise<HubSharePrepareResult> => {
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
    },
  )

  ipcMain.handle(
    'hub-share:publish',
    async (_e, args: { sessionUuid: string; note: string }): Promise<HubSharePublishResult> => {
      try {
        const token = (deps.loadTokenFn ?? loadToken)()
        if (!token) return { ok: false, error: 'UNAUTHENTICATED' }

        const entry =
          preparedCache.get(args.sessionUuid) ?? (await prepareEntry(args.sessionUuid, deps))
        const { prepared, card, spoolFile } = entry

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
          spoolFileOid: spoolFile === null ? null : spoolFile.oid,
        }

        const { missing } = await client.pushSession(prepared.sid, head)
        const missingSet = new Set(missing)
        const uploads = [
          ...prepared.records.map((record) => ({ oid: record.oid, data: record.data })),
          { oid: prepared.viewOid, data: prepared.viewData },
          ...(spoolFile === null ? [] : [spoolFile]),
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
    },
  )
}
