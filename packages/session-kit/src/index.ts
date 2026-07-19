export { splitRecords, canonicalizeRecord } from './records.js'
export { parseClaudeSessionText, parseCodexSessionLines } from './messages.js'
export type { ParseProviderResult, ParsedMessage, ParsedProviderSession } from './messages.js'
export {
  SPOOL_SYSTEM_PRELUDE_CLOSE,
  SPOOL_SYSTEM_PRELUDE_OPEN,
  stripSpoolSystemPrelude,
  wrapSpoolSystemPrelude,
} from './spool-prelude.js'
export { sequenceRoot, chainRoots } from './sequence.js'
export { extractEditEvents } from './edits.js'
export { deriveView } from './view.js'
export { composeSessionDiff } from './diff.js'

export type {
  DiscoveryAuthor,
  DiscoveryEngagementRequest,
  DiscoveryEngagementResponse,
  DiscoveryEvidence,
  DiscoveryLineage,
  DiscoverySessionItem,
  DiscoverySessionsResponse,
  DiscoverySort,
} from './discovery.js'

export type {
  CanonicalizeOptions,
  CanonicalRecord,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  Diffstat,
  EditEvent,
  EditTool,
  IndexedRecord,
  JsonPrimitive,
  JsonValue,
  SessionDiff,
  SessionFileDiff,
  SessionProvider,
  SessionRecord,
  SessionRecordsOptions,
  SessionViewV1,
  TextReplacement,
  ViewFileEntry,
  ViewIndexEntry,
  ViewOutlineEntry,
  ViewRecordKind,
} from './types.js'
