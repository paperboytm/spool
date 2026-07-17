// PROTOTYPE — throwaway (see NOTES.md in this directory).
// The one prop bag every variant receives from the host route. Data
// fetching stays in session-reader.tsx; variants only re-render it.

import type { SessionViewV1 } from '@spool-lab/session-kit'

import type { HubSessionMeta, RangeFetcher } from '../../../lib/hub-api'
import type { ParsedConversation } from '../../../lib/session-messages'

export interface VariantProps {
  meta: HubSessionMeta
  view: SessionViewV1 | null
  provider: 'claude' | 'codex'
  conversation: ParsedConversation
  isDark: boolean
  fetchRange: RangeFetcher
}
