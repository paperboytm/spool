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
  updateSessionCounts,
  setSessionScanProfile,
  invalidateAllScanProfiles,
  invalidateSessionScanProfile,
  listSessionsNeedingScan,
  listFindings,
  listSessionsWithFindings,
  riskByCategory,
  getFindingValue,
  getAllowlists,
  isAllowlisted,
  addAllowlistSession,
  addAllowlistGlobal,
  removeAllowlistSession,
  removeAllowlistGlobal,
  dismissFinding,
  undismissFinding,
} from './repo.js'
export type {
  FindingFilter,
  SessionFindingFilter,
  FindingInput,
  AllowlistSnapshot,
} from './repo.js'

export { scanSession, ScanError } from './scan.js'
export type { ScanResult, ScanSessionDeps } from './scan.js'

export { makeScanWorker, waitForIdle } from './worker.js'
export type { ScanWorker, WorkerConfig } from './worker.js'
