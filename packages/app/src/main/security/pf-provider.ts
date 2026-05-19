// pfProvider — RedactProvider implementation backed by ModelHost.
//
// Slots into the scan worker's providers list alongside regexProvider.
// `available()` is false until the model bundle is downloaded and
// the hidden inference window has handed back a `pf:ready` signal,
// so enabling pf in Settings is a no-op until those happen.

import type { RedactProvider, SensitiveMatch } from '@spool-lab/redact'
import { detectWithRegex } from '@spool-lab/redact'
import { Effect } from 'effect'
import { mapPfMatches } from './class-mapping.js'
import type { ModelHost } from './model-host.js'

export function makePfProvider(host: ModelHost): RedactProvider {
  return {
    name: 'pf',
    displayName: 'OpenAI Privacy Filter (on-device ML)',
    available: () => {
      // The ModelHost stores its readiness in a Ref; reading
      // synchronously here would require blocking, so we just default
      // to false. The scan worker calls available() before each
      // provider invocation, but if the host transitions to ready
      // mid-scan the next session picks it up.
      // A future refactor can hand `available` a sync-cached boolean.
      return false
    },
    analyze: async (text: string): Promise<SensitiveMatch[]> => {
      const ready = await Effect.runPromise(host.ready)
      if (!ready) return []
      const pfMatches = await Effect.runPromise(host.analyze(text)).catch(() => [])
      if (!pfMatches.length) return []
      // Cheap second regex pass for the class-mapping context. The
      // scan worker already runs regex separately, but mapping needs
      // the regex matches for the same string to drive the url /
      // secret suppression rules.
      const regexMatches = detectWithRegex(text, 'regex')
      return mapPfMatches(
        pfMatches as Parameters<typeof mapPfMatches>[0],
        { regexMatches, fullText: text },
      )
    },
  }
}
