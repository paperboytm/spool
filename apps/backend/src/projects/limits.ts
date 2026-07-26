export const MAX_ACTIVE_PROJECTS_PER_TENANT = 100
export const MAX_PROJECTS_PER_TENANT = 1_000
export const MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR = 10_000

export const DEFAULT_PROJECT_LIST_LIMIT = 50
export const MAX_PROJECT_LIST_LIMIT = 100

export const PROJECT_CREATE_RATE = {
  bucket: 'project-create',
  windowSec: 24 * 60 * 60,
  max: 100,
} as const

export const PROJECT_LIST_RATE = {
  bucket: 'project-list',
  windowSec: 60,
  max: 120,
} as const

export const MAX_PROJECT_DESCRIPTION_BYTES = 4 * 1024
