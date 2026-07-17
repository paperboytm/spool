export type SidebarSortOrder = 'recent' | 'name' | 'most_sessions'

export const DEFAULT_SIDEBAR_SORT_ORDER: SidebarSortOrder = 'recent'

export const SIDEBAR_SORT_OPTIONS: Array<{ value: SidebarSortOrder; label: string }> = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'most_sessions', label: 'Most sessions' },
]
