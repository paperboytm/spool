export type {
  FindingState,
  FindingRow,
  SessionWithFindingCounts,
  RiskByCategoryRow,
  DismissScope,
  FindingsChange,
  ScanStatus,
} from './types.js'

export {
  REDACT_DETECTOR_VERSION,
  currentProfileString,
  parseProfile,
  profilesMatch,
  providersInProfile,
} from './profile.js'
export type { ProfileOpts, ParsedProfile } from './profile.js'

export {
  insertFindings,
  deleteActiveFindings,
  deleteRefreshableFindings,
  updateSessionCounts,
  setSessionScanProfile,
  invalidateAllScanProfiles,
  invalidateSessionScanProfile,
  listSessionsNeedingScan,
  listFindings,
  listFindingsPage,
  listSessionsWithFindings,
  listSessionsWithFindingsPage,
  countSessionsWithFindings,
  riskByCategory,
  getFindingValue,
  getFindingValues,
  getAllowlists,
  isAllowlisted,
  addAllowlistSession,
  addAllowlistGlobal,
  removeAllowlistSession,
  removeAllowlistGlobal,
  listAllowlistEntries,
  dismissFinding,
  undismissFinding,
} from './repo.js'
export type {
  FindingFilter,
  SessionFindingFilter,
  FindingInput,
  AllowlistEntryRow,
  AllowlistSnapshot,
  Page,
} from './repo.js'

export { scanSession, ScanError } from './scan.js'
export type { ScanResult, ScanSessionDeps } from './scan.js'

export { purgeFinding, purgeFindings, orderForBulkPurge, PurgeError } from './purge.js'
export type { PurgeResult, PurgeDeps } from './purge.js'

export { makeScanWorker, waitForIdle } from './worker.js'
export type { ScanWorker, WorkerConfig } from './worker.js'
