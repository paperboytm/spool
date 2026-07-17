export type PinnedSortOrder = 'recent_pinned' | 'recent' | 'name'

export const DEFAULT_PINNED_SORT_ORDER: PinnedSortOrder = 'recent_pinned'

export const PINNED_SORT_OPTIONS: Array<{ value: PinnedSortOrder; label: string }> = [
  { value: 'recent_pinned', label: 'Recently pinned' },
  { value: 'recent', label: 'Recent activity' },
  { value: 'name', label: 'Name (A–Z)' },
]
