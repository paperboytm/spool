// Renders an immutable Snapshot in read-only mode using the appropriate
// template. This is the single entry point used by the spool.pro web
// reader at `/s/<id>`.
//
// SAFETY: never uses dangerouslySetInnerHTML on user content. All turn
// bodies flow through React's standard text-escaping path inside the
// existing template components (Forum / Letter / Timeline / Chat). The
// guard test in `packages/share-web/tests/safety.test.ts` enforces this
// across both share-web and the reader path.

import { useMemo } from 'react'
import { TemplateRender } from '../templates'
import type { Snapshot } from '../lib/types'
import { decodeSnapshot } from './snapshot-to-conversation'
import { useProgressiveTurns } from './use-progressive-turns'

export interface SnapshotReaderProps {
  snapshot: Snapshot
}

export function SnapshotReader({ snapshot }: SnapshotReaderProps) {
  // Decode once per snapshot — the sort + map over every turn must not
  // re-run on each progressive-fill frame.
  const { conversation, opts } = useMemo(() => decodeSnapshot(snapshot), [snapshot])

  // Mount the document progressively so a large snapshot doesn't block
  // first paint. The decoded snapshot renders with `redact: false`, so
  // the sliced re-renders don't retrigger detection (see
  // `useResolvedRedactList`) and a full-conversation redact list is not
  // needed for stability.
  const total = conversation.turns.length
  const mounted = useProgressiveTurns(total)
  const convo = useMemo(
    () =>
      mounted >= total
        ? conversation
        : { ...conversation, turns: conversation.turns.slice(0, mounted) },
    [conversation, mounted, total],
  )

  return <TemplateRender template={opts.template} convo={convo} opts={opts} />
}
