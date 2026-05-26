// Renderer-side Security Scan API adapter.
//
// Why: per the spec's "Effect TS scope" §7.3 — React must not import
// IPC channel names directly. All renderer calls go through this
// file. When (if) we migrate to effect-rx hooks, only this file
// changes; consuming components don't.

import type {
  FindingFilter,
  SessionFindingFilter,
  FindingRow,
  SessionWithFindingCounts,
  RiskByCategoryRow,
  OccurrenceBySession,
  FindingsChange,
  ScanStatus,
  AllowlistEntryRow,
  Page,
  BackupFileInfo,
  DeleteBackupsResult,
} from '@spool-lab/core'

export type { OccurrenceBySession }

export type { BackupFileInfo }
import type { SensitiveKind } from '@spool-lab/redact'
import type { SecurityPreferences, PfDownloadState, PfRuntimeInfo, SecurityReadiness } from '../../preload/index.js'

export type { SecurityPreferences, AllowlistEntryRow, PfDownloadState, PfRuntimeInfo, SecurityReadiness }

/** Single source of truth for the renderer-side adapter. Components
 *  hold this object, not `window.spool.security` — keeps replaceability
 *  high. */
export const securityApi = {
  listFindings: (filter: FindingFilter = {}): Promise<FindingRow[]> =>
    window.spool.security.listFindings(filter),
  listFindingsPage: (filter: FindingFilter = {}): Promise<Page<FindingRow>> =>
    window.spool.security.listFindingsPage(filter),
  listSessionsWithFindings: (filter: SessionFindingFilter = {}): Promise<SessionWithFindingCounts[]> =>
    window.spool.security.listSessionsWithFindings(filter),
  listSessionsWithFindingsPage: (filter: SessionFindingFilter = {}): Promise<Page<SessionWithFindingCounts>> =>
    window.spool.security.listSessionsWithFindingsPage(filter),
  countSessionsWithFindings: (filter: SessionFindingFilter = {}): Promise<number> =>
    window.spool.security.countSessionsWithFindings(filter),
  occurrencesByValueHash: (kind: SensitiveKind, valueHash: string): Promise<OccurrenceBySession[]> =>
    window.spool.security.occurrencesByValueHash(kind, valueHash),
  riskByCategory: (): Promise<RiskByCategoryRow[]> =>
    window.spool.security.riskByCategory(),
  lastScanCompletedAt: (): Promise<string | null> =>
    window.spool.security.lastScanCompletedAt(),
  getFindingValue: (findingId: number): Promise<string | null> =>
    window.spool.security.getFindingValue(findingId),
  getFindingValues: (ids: number[]): Promise<Record<number, string | null>> =>
    window.spool.security.getFindingValues(ids),
  getScanStatus: (): Promise<ScanStatus> =>
    window.spool.security.getScanStatus(),

  dismissFinding: (findingId: number, scope: 'session' | 'global') =>
    window.spool.security.dismissFinding(findingId, scope),
  dismissFindings: (findingIds: number[], scope: 'session' | 'global') =>
    window.spool.security.dismissFindings(findingIds, scope),
  undismissFinding: (findingId: number) =>
    window.spool.security.undismissFinding(findingId),
  purgeFinding: (findingId: number) =>
    window.spool.security.purgeFinding(findingId),
  purgeFindings: (findingIds: number[]) =>
    window.spool.security.purgeFindings(findingIds),
  rescanAll: () => window.spool.security.rescanAll(),
  rescanSession: (sessionId: number) => window.spool.security.rescanSession(sessionId),

  onChange: (handler: (c: FindingsChange) => void): (() => void) =>
    window.spool.security.onFindingsChanged(handler),
  onScanStatus: (handler: (s: ScanStatus) => void): (() => void) =>
    window.spool.security.onScanStatus(handler),

  getPrefs: (): Promise<SecurityPreferences> =>
    window.spool.security.getPrefs(),
  setPrefs: (next: Partial<SecurityPreferences>): Promise<SecurityPreferences> =>
    window.spool.security.setPrefs(next),
  onPrefsChanged: (handler: (p: SecurityPreferences) => void): (() => void) =>
    window.spool.security.onPrefsChanged(handler),

  listAllowlistEntries: (): Promise<AllowlistEntryRow[]> =>
    window.spool.security.listAllowlistEntries(),
  countAllowlistEntries: (): Promise<number> =>
    window.spool.security.countAllowlistEntries(),
  removeAllowlistEntry: (args: {
    scope: 'session' | 'global'
    kind: SensitiveKind
    valueHash: string
    sessionUuid?: string
  }) => window.spool.security.removeAllowlistEntry(args),

  listBackups: (): Promise<BackupFileInfo[]> =>
    window.spool.security.listBackups(),
  deleteBackups: (names: string[]): Promise<DeleteBackupsResult> =>
    window.spool.security.deleteBackups({ names }),

  pfGetState: (): Promise<PfDownloadState> =>
    window.spool.security.pfGetState(),
  pfDownloadStart: (): Promise<{ ok: boolean; reason?: string }> =>
    window.spool.security.pfDownloadStart(),
  pfDownloadCancel: (): Promise<{ ok: boolean }> =>
    window.spool.security.pfDownloadCancel(),
  pfGetRuntimeInfo: (): Promise<PfRuntimeInfo | null> =>
    window.spool.security.pfGetRuntimeInfo(),
  onPfState: (handler: (s: PfDownloadState) => void): (() => void) =>
    window.spool.security.onPfState(handler),

  getReadiness: (): Promise<SecurityReadiness> =>
    window.spool.security.getReadiness(),
  onReadinessChanged: (handler: (s: SecurityReadiness) => void): (() => void) =>
    window.spool.security.onReadinessChanged(handler),
}

export type SecurityApi = typeof securityApi
