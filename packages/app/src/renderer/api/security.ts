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
} from '@spool-lab/core'

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
  getScanStatus: (): Promise<ScanStatus> =>
    window.spool.security.getScanStatus(),

  onChange: (handler: (c: FindingsChange) => void): (() => void) =>
    window.spool.security.onFindingsChanged(handler),
  onScanStatus: (handler: (s: ScanStatus) => void): (() => void) =>
    window.spool.security.onScanStatus(handler),
}

export type SecurityApi = typeof securityApi
