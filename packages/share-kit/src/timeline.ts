// Side-effect-free renderer entry for hosts that need the shared timeline
// without importing browser-only exporters from the package root.

export { TimelineBody } from './templates/timeline'
export type { TimelineBodyProps } from './templates/timeline'
export { selectSegments } from './templates/selection'
export type { KeptTurn, SelectedSegments } from './templates/selection'
export { firstLinePreview } from './lib/first-line-preview'
export { collectRedactList, redactPlainText } from './templates/redact'
export type { RedactReplacement } from './templates/redact'
