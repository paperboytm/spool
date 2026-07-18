import { createServerOnlyFn } from '@tanstack/react-start'

// Read per request: Workers inject text bindings into process.env at request
// time under nodejs_compat, not while the module is being initialized.
const readBackendOrigin = createServerOnlyFn(() => process.env.ORIGIN_BACKEND)

/** SSR calls the Pages backend directly rather than recursively fetching the
 * public spool.pro Worker route. */
export function apiOriginFor(backendOrigin: string): string {
  return new URL(backendOrigin).origin
}

export function serverApiOrigin(): string {
  return apiOriginFor(readBackendOrigin())
}
