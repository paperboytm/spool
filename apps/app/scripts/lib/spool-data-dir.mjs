import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Decide which SPOOL_DATA_DIR a process launched via the dev wrapper
 * should run with. Pure — easy to test, no side effects.
 *
 *   - If the caller already has SPOOL_DATA_DIR set, respect it.
 *   - Otherwise default to ~/.spool-dev/ so dev never touches the user's
 *     real ~/.spool/.
 *
 * Returns `{ value, source }` where `source` is:
 *   - 'env'      → caller already had it set; we did not change anything
 *   - 'default'  → we computed and chose the dev-mode default
 */
export function resolveSpoolDataDir(env, home = homedir()) {
  if (env.SPOOL_DATA_DIR) {
    return { value: env.SPOOL_DATA_DIR, source: 'env' }
  }
  return { value: join(home, '.spool-dev'), source: 'default' }
}
