// Lean subpath entry (`@spool/share-kit/progressive`) exposing only the
// progressive-mount hook. The main barrel drags in the full template /
// markdown render chain, which requires a DOM at import time — hosts
// that only need the fill state machine (the editor preview, node-env
// unit tests) import this entry instead.

export {
  useProgressiveTurns,
  nextReaderCount,
  READER_INITIAL_TURNS,
  READER_TURNS_PER_FRAME,
} from './reader/use-progressive-turns'
