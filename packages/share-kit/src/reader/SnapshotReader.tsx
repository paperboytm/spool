// Renders an immutable Snapshot in read-only mode using the appropriate
// template. This is the single entry point used by the spool.pro web
// reader at `/s/<id>`.
//
// SAFETY: never uses dangerouslySetInnerHTML on user content. All turn
// bodies flow through React's standard text-escaping path inside the
// existing template components (Forum / Letter / Timeline / Chat). The
// guard test in `packages/share-web/tests/safety.test.ts` enforces this
// across both share-web and the reader path.

import { TemplateRender } from '../templates'
import type { Snapshot } from '../lib/types'
import { decodeSnapshot } from './snapshot-to-conversation'

export interface SnapshotReaderProps {
  snapshot: Snapshot
}

export function SnapshotReader({ snapshot }: SnapshotReaderProps) {
  const { conversation, opts } = decodeSnapshot(snapshot)
  return <TemplateRender template={opts.template} convo={conversation} opts={opts} />
}
