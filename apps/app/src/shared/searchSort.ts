export type SearchSortOrder = 'relevance' | 'newest' | 'oldest'

export const DEFAULT_SEARCH_SORT_ORDER: SearchSortOrder = 'relevance'

export const SEARCH_SORT_OPTIONS: Array<{ value: SearchSortOrder; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]
