import { contextBridge, ipcRenderer } from 'electron'
import type {
  FragmentResult, Session, Message, StatusInfo, SyncResult, SearchResult, ProjectGroup,
  ListSessionsByIdentityOptions, ProjectSessionSortOrder, SessionsCursor, SessionsPage, DirectoryCount,
  ShareDraftRow, ShareDraftListItem, UpsertShareDraftInput,
  PublishedShareCacheItem,
  SessionSource,
  FindingRow, SessionWithFindingCounts, RiskByCategoryRow, OccurrenceBySession,
  FindingsChange, ScanStatus, FindingFilter, SessionFindingFilter,
  AllowlistEntryRow,
  Page,
  BackupFileInfo, DeleteBackupsResult,
} from '@spool-lab/core'
import type { SensitiveKind } from '@spool-lab/redact'

export interface SecurityPreferences {
  kindAllowlist: SensitiveKind[]
  infoDefaultVisible: boolean
  rescanAfterSync: 'auto' | 'manual'
  securityPageValuesBlurred: boolean
  findingsStripValuesBlurred: boolean
  pfEnabled: boolean
  pfCalloutDismissed: boolean
  pfActivationPending: boolean
  sessionRowRiskIconVisible: boolean
}

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

export interface PfRuntimeInfo {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  runtime: 'webgpu' | 'wasm' | null
  adapterLabel?: string
  detectionMs?: number
  error?: string
}

export type SecurityReadiness =
  | { ready: true }
  | { ready: false; reason: 'booting' | 'scanner-unavailable' }
import type { SearchSortOrder } from '../shared/searchSort.js'
import type { SidebarSortOrder } from '../shared/sidebarSort.js'
import type { PinnedSortOrder } from '../shared/pinnedSort.js'
import type { ThemeEditorStateV1 } from '../renderer/theme/editorTypes.js'
import type {
  PublishRequestBody,
  PublishResult,
  MySharesResponse,
  HandleCheckResponse,
  HandleClaimResponse,
  ScheduleDeleteResponse,
} from '../shared/share-publish.js'

export interface AgentInfo {
  id: string
  name: string
  path: string
  status: 'ready' | 'not_found' | 'not_running'
  acpMode: 'extension' | 'native' | 'websocket'
}

export interface BuiltinAgent {
  name: string
  bin: string
  acpMode: 'extension' | 'native' | 'websocket'
}

export type LanguagePreference = 'system' | 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'de' | 'fr'
export type RuntimePlatform = NodeJS.Platform

export interface AgentsConfig {
  defaultAgent?: string
  defaultSearchSort?: SearchSortOrder
  terminal?: string
  /** Labs opt-in for the Security Scan feature. See main/acp.ts. */
  securityEnabled?: boolean
  sidebarShowSourceDots?: boolean
  sidebarShowSessionCount?: boolean
  sidebarSortOrder?: SidebarSortOrder
  pinnedSortOrder?: PinnedSortOrder
  projectSortOrder?: ProjectSessionSortOrder
  /** UI language; 'system' follows OS preference (default). */
  language?: LanguagePreference
  customAgents?: Record<string, {
    name?: string
    bin: string
    acpMode: 'extension' | 'native' | 'websocket'
    acpArgs?: string[]
    wsEndpoint?: string
    healthCheck?: string
  }>
}

export type SpoolAPI = typeof api

const api = {
  platform: process.platform as RuntimePlatform,

  search: (query: string, limit?: number, source?: string, onlyPinned?: boolean, identityKey?: string): Promise<SearchResult[]> =>
    ipcRenderer.invoke('spool:search', { query, limit, source, onlyPinned, identityKey }),

  searchPreview: (query: string, limit?: number, source?: string): Promise<SearchResult[]> =>
    ipcRenderer.invoke('spool:search-preview', { query, limit, source }),

  listSessions: (options?: { limit?: number; cursor?: SessionsCursor }): Promise<SessionsPage> =>
    ipcRenderer.invoke('spool:list-sessions', options ?? {}),

  listProjectGroups: (): Promise<ProjectGroup[]> =>
    ipcRenderer.invoke('spool:list-project-groups'),

  listSessionsByIdentity: (identityKey: string, options?: ListSessionsByIdentityOptions): Promise<SessionsPage> =>
    ipcRenderer.invoke('spool:list-sessions-by-identity', { identityKey, options }),

  listProjectDirectoryCounts: (identityKey: string, sources?: SessionSource[]): Promise<DirectoryCount[]> =>
    ipcRenderer.invoke('spool:list-project-directory-counts', { identityKey, sources }),

  getSession: (sessionUuid: string): Promise<{ session: Session; messages: Message[] } | null> =>
    ipcRenderer.invoke('spool:get-session', { sessionUuid }),

  getStatus: (): Promise<StatusInfo> =>
    ipcRenderer.invoke('spool:get-status'),

  pinSession: (uuid: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:pin-session', { uuid }),

  unpinSession: (uuid: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:unpin-session', { uuid }),

  getPinnedUuids: (): Promise<string[]> =>
    ipcRenderer.invoke('spool:get-pinned-uuids'),

  listPinnedSessions: (): Promise<Session[]> =>
    ipcRenderer.invoke('spool:list-pinned-sessions'),

  listPinnedSessionsByIdentity: (identityKey: string): Promise<Session[]> =>
    ipcRenderer.invoke('spool:list-pinned-sessions-by-identity', { identityKey }),

  getRuntimeInfo: (): Promise<{ isDev: boolean; appPath: string; appName: string }> =>
    ipcRenderer.invoke('spool:get-runtime-info'),

  /** Returns the OS-preferred locale mapped to one Spool supports, or 'en'. */
  getSystemLocale: (): Promise<'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'de' | 'fr'> =>
    ipcRenderer.invoke('spool:get-system-locale'),

  syncNow: (): Promise<SyncResult> =>
    ipcRenderer.invoke('spool:sync-now'),

  forceResyncSession: (sessionUuid: string): Promise<
    { ok: true; result: 'added' | 'updated' | 'skipped' }
    | { ok: false; error: string }
  > =>
    ipcRenderer.invoke('spool:force-resync-session', { sessionUuid }),

  resumeCLI: (sessionUuid: string, source: string, cwd?: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('spool:resume-cli', { sessionUuid, source, cwd }),

  copyFragment: (text: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:copy-fragment', { text }),

  getSidebarCollapsed: (): Promise<boolean> =>
    ipcRenderer.invoke('spool:get-sidebar-collapsed'),

  setSidebarCollapsed: (collapsed: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:set-sidebar-collapsed', { collapsed }),

  shareDraft: {
    list: (limit?: number): Promise<ShareDraftListItem[]> =>
      ipcRenderer.invoke('spool:list-share-drafts', { limit }),
    get: (draftId: string): Promise<ShareDraftRow | null> =>
      ipcRenderer.invoke('spool:get-share-draft', { draftId }),
    upsert: (input: UpsertShareDraftInput): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('spool:upsert-share-draft', { input }),
    delete: (draftId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('spool:delete-share-draft', { draftId }),
    countBySession: (sessionUuid: string): Promise<number> =>
      ipcRenderer.invoke('spool:count-drafts-by-session', { sessionUuid }),
  },

  // AI / ACP
  getAiAgents: (): Promise<AgentInfo[]> =>
    ipcRenderer.invoke('spool:ai-agents'),

  getBuiltinAgents: (): Promise<Record<string, BuiltinAgent>> =>
    ipcRenderer.invoke('spool:ai-builtin-agents'),

  getAgentsConfig: (): Promise<AgentsConfig> =>
    ipcRenderer.invoke('spool:ai-get-config'),

  setAgentsConfig: (config: AgentsConfig): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:ai-set-config', { config }),

  aiSearch: (query: string, agentId: string, context: FragmentResult[]): Promise<{ ok: boolean; fullText?: string; error?: string }> =>
    ipcRenderer.invoke('spool:ai-search', { query, agentId, context }),

  aiCancel: (agentId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:ai-cancel', { agentId }),

  onAiChunk: (cb: (data: { text: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { text: string })
    ipcRenderer.on('spool:ai-chunk', handler)
    return () => ipcRenderer.removeListener('spool:ai-chunk', handler)
  },

  onAiDone: (cb: (data: { fullText: string; error?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { fullText: string; error?: string })
    ipcRenderer.on('spool:ai-done', handler)
    return () => ipcRenderer.removeListener('spool:ai-done', handler)
  },

  onAiToolCall: (cb: (data: { toolCallId: string; title: string; status: string; kind?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { toolCallId: string; title: string; status: string; kind?: string })
    ipcRenderer.on('spool:ai-tool-call', handler)
    return () => ipcRenderer.removeListener('spool:ai-tool-call', handler)
  },

  onAiSessionStarted: (cb: (data: { sessionUuid: string; source: string; cwd: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { sessionUuid: string; source: string; cwd: string })
    ipcRenderer.on('spool:ai-session-started', handler)
    return () => ipcRenderer.removeListener('spool:ai-session-started', handler)
  },

  onSyncProgress: (cb: (e: { phase: string; count: number; total: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { phase: string; count: number; total: number })
    ipcRenderer.on('spool:sync-progress', handler)
    return () => ipcRenderer.removeListener('spool:sync-progress', handler)
  },

  onNewSessions: (cb: (data: { count: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { count: number })
    ipcRenderer.on('spool:new-sessions', handler)
    return () => ipcRenderer.removeListener('spool:new-sessions', handler)
  },

  getTheme: (): Promise<'system' | 'light' | 'dark'> =>
    ipcRenderer.invoke('spool:get-theme'),

  setTheme: (theme: 'system' | 'light' | 'dark'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:set-theme', { theme }),

  getThemeEditorState: (): Promise<ThemeEditorStateV1 | null> =>
    ipcRenderer.invoke('spool:get-theme-editor-state'),

  setThemeEditorState: (state: ThemeEditorStateV1): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('spool:set-theme-editor-state', { state }),

  // Auto-update
  onUpdateStatus: (cb: (data: { status: 'available' | 'downloading' | 'ready' | 'error'; version?: string; percent?: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as { status: 'available' | 'downloading' | 'ready' | 'error'; version?: string; percent?: number })
    ipcRenderer.on('spool:update-status', handler)
    return () => ipcRenderer.removeListener('spool:update-status', handler)
  },

  downloadUpdate: (): Promise<void> =>
    ipcRenderer.invoke('spool:download-update'),

  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke('spool:install-update'),

  printToPdf: (html: string, widthPx: number, heightPx: number): Promise<Uint8Array> =>
    ipcRenderer.invoke('spool:print-to-pdf', { html, widthPx, heightPx }),

  // Security Scan — query + dismiss + rescan surface. Purge arrives in PR 4.
  security: {
    listFindings: (filter: FindingFilter): Promise<FindingRow[]> =>
      ipcRenderer.invoke('security:list-findings', filter),
    listFindingsPage: (filter: FindingFilter): Promise<Page<FindingRow>> =>
      ipcRenderer.invoke('security:list-findings-page', filter),
    listSessionsWithFindings: (filter: SessionFindingFilter): Promise<SessionWithFindingCounts[]> =>
      ipcRenderer.invoke('security:list-sessions-with-findings', filter),
    listSessionsWithFindingsPage: (filter: SessionFindingFilter): Promise<Page<SessionWithFindingCounts>> =>
      ipcRenderer.invoke('security:list-sessions-with-findings-page', filter),
    countSessionsWithFindings: (filter: SessionFindingFilter): Promise<number> =>
      ipcRenderer.invoke('security:count-sessions-with-findings', filter),
    occurrencesByValueHash: (kind: SensitiveKind, valueHash: string): Promise<OccurrenceBySession[]> =>
      ipcRenderer.invoke('security:occurrences-by-value-hash', { kind, valueHash }),
    riskByCategory: (): Promise<RiskByCategoryRow[]> =>
      ipcRenderer.invoke('security:risk-by-category'),
    lastScanCompletedAt: (): Promise<string | null> =>
      ipcRenderer.invoke('security:last-scan-completed-at'),
    getFindingValue: (findingId: number): Promise<string | null> =>
      ipcRenderer.invoke('security:get-finding-value', findingId),
    getFindingValues: (ids: number[]): Promise<Record<number, string | null>> =>
      ipcRenderer.invoke('security:get-finding-values', ids),
    getScanStatus: (): Promise<ScanStatus> =>
      ipcRenderer.invoke('security:get-scan-status'),
    dismissFinding: (findingId: number, scope: 'session' | 'global'): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('security:dismiss-finding', { findingId, scope }),
    dismissFindings: (findingIds: number[], scope: 'session' | 'global'): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('security:dismiss-findings', { findingIds, scope }),
    undismissFinding: (findingId: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('security:undismiss-finding', { findingId }),
    purgeFinding: (findingId: number): Promise<{ findingId: number; sessionId: number; maskUsed: string; purgedAt: string }> =>
      ipcRenderer.invoke('security:purge-finding', findingId),
    purgeFindings: (findingIds: number[]): Promise<Array<{ findingId: number; sessionId: number; maskUsed: string; purgedAt: string }>> =>
      ipcRenderer.invoke('security:purge-findings', findingIds),
    purgeEverywhere: (kind: SensitiveKind, valueHash: string): Promise<{ count: number; sessionIds: number[] }> =>
      ipcRenderer.invoke('security:purge-everywhere', { kind, valueHash }),
    rescanAll: (): Promise<{ count: number }> =>
      ipcRenderer.invoke('security:rescan-all'),
    rescanSession: (sessionId: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('security:rescan-session', sessionId),
    onFindingsChanged: (cb: (change: FindingsChange) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as FindingsChange)
      ipcRenderer.on('security:evt-findings-changed', handler)
      return () => ipcRenderer.removeListener('security:evt-findings-changed', handler)
    },
    onScanStatus: (cb: (status: ScanStatus) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as ScanStatus)
      ipcRenderer.on('security:evt-scan-status', handler)
      return () => ipcRenderer.removeListener('security:evt-scan-status', handler)
    },

    getPrefs: (): Promise<SecurityPreferences> =>
      ipcRenderer.invoke('security:get-prefs'),
    setPrefs: (next: Partial<SecurityPreferences>): Promise<SecurityPreferences> =>
      ipcRenderer.invoke('security:set-prefs', next),
    onPrefsChanged: (cb: (prefs: SecurityPreferences) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as SecurityPreferences)
      ipcRenderer.on('security:evt-prefs-changed', handler)
      return () => ipcRenderer.removeListener('security:evt-prefs-changed', handler)
    },

    listAllowlistEntries: (): Promise<AllowlistEntryRow[]> =>
      ipcRenderer.invoke('security:list-allowlist-entries'),
    countAllowlistEntries: (): Promise<number> =>
      ipcRenderer.invoke('security:count-allowlist-entries'),
    removeAllowlistEntry: (args: {
      scope: 'session' | 'global'
      kind: SensitiveKind
      valueHash: string
      sessionUuid?: string
    }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('security:remove-allowlist-entry', args),

    listBackups: (): Promise<BackupFileInfo[]> =>
      ipcRenderer.invoke('security:list-backups'),
    deleteBackups: (args: { names: string[] }): Promise<DeleteBackupsResult> =>
      ipcRenderer.invoke('security:delete-backups', args),

    pfGetState: (): Promise<PfDownloadState> =>
      ipcRenderer.invoke('security:pf-get-state'),
    pfDownloadStart: (): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('security:pf-download-start'),
    pfDownloadCancel: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('security:pf-download-cancel'),
    pfGetRuntimeInfo: (): Promise<PfRuntimeInfo | null> =>
      ipcRenderer.invoke('security:pf-get-runtime-info'),
    onPfState: (cb: (state: PfDownloadState) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as PfDownloadState)
      ipcRenderer.on('security:evt-pf-state', handler)
      return () => ipcRenderer.removeListener('security:evt-pf-state', handler)
    },

    getReadiness: (): Promise<SecurityReadiness> =>
      ipcRenderer.invoke('security:get-readiness'),
    onReadinessChanged: (cb: (state: SecurityReadiness) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as SecurityReadiness)
      ipcRenderer.on('security:evt-readiness-changed', handler)
      return () => ipcRenderer.removeListener('security:evt-readiness-changed', handler)
    },
  },
}

contextBridge.exposeInMainWorld('spool', api)

export interface ShareAuthUser {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  handle: string | null
}

const spoolShare = {
  authAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('share-auth:available'),
  // Optional provider: defaults to Google when omitted. Caller hard-codes
  // the choice (no auto-picking) so an outdated renderer can't accidentally
  // sign the user in with a provider they didn't pick from the SignIn UI.
  signIn: (arg?: { provider?: 'google' }): Promise<ShareAuthUser> =>
    ipcRenderer.invoke('share-auth:signin', arg),
  me: (): Promise<ShareAuthUser | null> =>
    ipcRenderer.invoke('share-auth:me'),
  signOut: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('share-auth:signout'),

  publish: (body: PublishRequestBody): Promise<PublishResult> =>
    ipcRenderer.invoke('share-publish:publish', body),
  revoke: (id: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('share-publish:revoke', id),
  myShares: (): Promise<MySharesResponse> =>
    ipcRenderer.invoke('share-publish:my-shares'),
  claimHandle: (handle: string): Promise<HandleClaimResponse> =>
    ipcRenderer.invoke('share-publish:claim-handle', handle),
  checkHandle: (handle: string): Promise<HandleCheckResponse> =>
    ipcRenderer.invoke('share-publish:check-handle', handle),
}

export type SpoolShareAPI = typeof spoolShare

contextBridge.exposeInMainWorld('spoolShare', spoolShare)

declare global {
  interface Window {
    spool: SpoolAPI
    spoolShare: SpoolShareAPI
  }
}
