/** Cache-control headers used across endpoints. Named so each callsite
 *  documents the policy intent instead of a stringly-typed value. */
export const CC_NO_STORE = 'no-store'
export const CC_PRIVATE_NO_CACHE = 'private, no-cache'

export function ccPublicRevalidate(seconds: number): string {
  return `public, max-age=${seconds}, must-revalidate`
}

export function ccPublic(seconds: number): string {
  return `public, max-age=${seconds}`
}
