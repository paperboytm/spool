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
  FindingsChange,
  ScanStatus,
  AllowlistEntryRow,
} from '@spool-lab/core'
import type { SensitiveKind } from '@spool-lab/redact'
import type { SecurityPreferences } from '../../preload/index.js'

export type { SecurityPreferences, AllowlistEntryRow }

/** Single source of truth for the renderer-side adapter. Components
 *  hold this object, not `window.spool.security` — keeps replaceability
 *  high. */
export const securityApi = {
  listFindings: (filter: FindingFilter = {}): Promise<FindingRow[]> =>
    window.spool.security.listFindings(filter),
  listSessionsWithFindings: (filter: SessionFindingFilter = {}): Promise<SessionWithFindingCounts[]> =>
    window.spool.security.listSessionsWithFindings(filter),
  riskByCategory: (): Promise<RiskByCategoryRow[]> =>
    window.spool.security.riskByCategory(),
  getFindingValue: (findingId: number): Promise<string | null> =>
    window.spool.security.getFindingValue(findingId),
  getFindingValues: (ids: number[]): Promise<Record<number, string | null>> =>
    window.spool.security.getFindingValues(ids),
  getScanStatus: (): Promise<ScanStatus> =>
    window.spool.security.getScanStatus(),

  dismissFinding: (findingId: number, scope: 'session' | 'global') =>
    window.spool.security.dismissFinding(findingId, scope),
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
  removeAllowlistEntry: (args: {
    scope: 'session' | 'global'
    kind: SensitiveKind
    valueHash: string
    sessionUuid?: string
  }) => window.spool.security.removeAllowlistEntry(args),
}

export type SecurityApi = typeof securityApi
