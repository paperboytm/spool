import type { ProjectSessionSortOrder } from '@spool-lab/core'

export const DEFAULT_PROJECT_SORT_ORDER: ProjectSessionSortOrder = 'recent'

export const PROJECT_SORT_OPTIONS: Array<{ value: ProjectSessionSortOrder; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_messages', label: 'Most messages' },
  { value: 'title', label: 'Title' },
]
