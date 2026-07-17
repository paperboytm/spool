// Moved to @spool-lab/session-kit so the web reader strips the same
// prelude; re-exported here to keep core's public surface stable.
export {
  SPOOL_SYSTEM_PRELUDE_CLOSE,
  SPOOL_SYSTEM_PRELUDE_OPEN,
  stripSpoolSystemPrelude,
  wrapSpoolSystemPrelude,
} from '@spool-lab/session-kit'
