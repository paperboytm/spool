export { splitRecords, canonicalizeRecord } from './records.js'
export { sequenceRoot, chainRoots } from './sequence.js'
export { extractEditEvents } from './edits.js'
export { deriveView } from './view.js'
export { composeSessionDiff } from './diff.js'

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
