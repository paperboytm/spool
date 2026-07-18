import { exec, execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * Resolve a binary path that works in both terminal-launched and
 * GUI-launched (minimal PATH) contexts on macOS.
 *
 * Strategy: process PATH → user login+interactive shell → bash fallback →
 * well-known install locations (homebrew, ~/.local/bin, nvm, mise).
 *
 * The interactive (-i) flag is what picks up version managers that activate
 * in .zshrc / .bashrc (mise, asdf, fnm, etc.) rather than only profile files.
 */

export function nvmVersionBins(home: string, name: string): string[] {
  const versionsDir = join(home, '.nvm', 'versions', 'node')
  try {
    return readdirSync(versionsDir)
      .filter((d) => d.startsWith('v'))
      .sort()
      .reverse()
      .map((d) => join(versionsDir, d, 'bin', name))
  } catch {
    return []
  }
}

/**
 * Enumerate mise-managed binary paths for a given tool name.
 * mise installs under ~/.local/share/mise/installs/<plugin>/<version>/bin/<name>,
 * and exposes shims at ~/.local/share/mise/shims/<name>. We check the shim first
 * (it's a stable entry point), then scan installed versions newest-first.
 */
export function miseVersionBins(home: string, name: string): string[] {
  const root = join(home, '.local', 'share', 'mise')
  const result: string[] = [join(root, 'shims', name)]

  const installsDir = join(root, 'installs')
  let plugins: string[]
  try {
    plugins = readdirSync(installsDir)
  } catch {
    return result
  }

  for (const plugin of plugins) {
    const pluginDir = join(installsDir, plugin)
    let versions: string[]
    try {
      versions = readdirSync(pluginDir)
    } catch {
      continue
    }
    const ordered = versions.includes('latest')
      ? [
          'latest',
          ...versions
            .filter((v) => v !== 'latest')
            .sort()
            .reverse(),
        ]
      : versions.sort().reverse()
    for (const v of ordered) {
      result.push(join(pluginDir, v, 'bin', name))
    }
  }
  return result
}

/** Ordered list of filesystem paths to probe for `name`. Pure. */
export function wellKnownBinPaths(name: string, home: string, extras: string[] = []): string[] {
  return [
    ...extras,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `${home}/.local/bin/${name}`,
    `${home}/.nvm/current/bin/${name}`,
    ...nvmVersionBins(home, name),
    ...miseVersionBins(home, name),
  ]
}

function shellLookup(shell: string, flags: string, name: string, timeoutMs: number): string | null {
  try {
    const p = execSync(`${shell} ${flags} 'command -v ${name}'`, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return p || null
  } catch {
    return null
  }
}

export function resolveSystemBinary(name: string, extraSearchPaths: string[] = []): string | null {
  // 1. Current process PATH — fast path for terminal-launched contexts
  try {
    const p = execSync(`command -v ${name}`, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (p) return p
  } catch {}

  // 2. User's login+interactive shell — covers mise/asdf/fnm activated in .zshrc/.bashrc
  const userShell = process.env['SHELL']
  if (userShell) {
    const p = shellLookup(userShell, '-ilc', name, 5000)
    if (p) return p
  }

  // 3. Bash fallback — in case SHELL is unset or the user's shell is broken
  if (!userShell || !userShell.endsWith('bash')) {
    const p = shellLookup('bash', '-lc', name, 5000)
    if (p) return p
  }

  // 4. Well-known install locations
  for (const p of wellKnownBinPaths(name, homedir(), extraSearchPaths)) {
    if (existsSync(p)) return p
  }
  return null
}

const resolvedPaths: Record<string, string | null> = {}

/** Cached version of resolveSystemBinary — result persists for process lifetime. */
export function cachedResolve(name: string, extras: string[] = []): string | null {
  if (!(name in resolvedPaths)) {
    resolvedPaths[name] = resolveSystemBinary(name, extras)
  }
  return resolvedPaths[name] ?? null
}

/** Clear a cached resolve entry (e.g. after installing a new binary). */
export function clearResolveCache(name: string): void {
  delete resolvedPaths[name]
}

// ── Async API ─────────────────────────────────────────────────────────────
// The sync variants above use execSync('<shell> -ilc ...') which spawns a
// fresh interactive login shell and can take seconds when the user's
// .zshrc is heavy. Awaiting calls to those from the Electron main process
// stalls the event loop and produces a launch beachball. Async callers
// should prefer this set: it both removes the main-thread block and lets
// independent resolves run concurrently via Promise.all.
//
// Tries cheaper sources first — process PATH, then well-known install
// locations (which catch homebrew, ~/.local/bin, nvm and mise shims via
// straight filesystem checks) — and only falls back to the slow
// interactive-shell lookup when nothing else turned up. Empirically the
// well-known paths cover almost every install on macOS, so the slow path
// is reserved for users whose binaries genuinely only exist behind a
// shell-activated alias or function.

async function shellLookupAsync(
  shell: string,
  flags: string,
  name: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${shell} ${flags} 'command -v ${name}'`, {
      encoding: 'utf8',
      timeout: timeoutMs,
    })
    const p = stdout.trim()
    return p || null
  } catch {
    return null
  }
}

export async function resolveSystemBinaryAsync(
  name: string,
  extraSearchPaths: string[] = [],
): Promise<string | null> {
  // 1. Current process PATH — fastest, covers terminal-launched contexts
  try {
    const { stdout } = await execAsync(`command -v ${name}`, { encoding: 'utf8', timeout: 3000 })
    const p = stdout.trim()
    if (p) return p
  } catch {}

  // 2. Well-known install locations — pure filesystem probes, no shell exec.
  //    Covers homebrew, ~/.local/bin, nvm versions, and mise installs/shims.
  for (const p of wellKnownBinPaths(name, homedir(), extraSearchPaths)) {
    if (existsSync(p)) return p
  }

  // 3. User's login+interactive shell — last because each spawn pays for
  //    the user's full shell init (mise/asdf/fnm activation, .zshrc).
  const userShell = process.env['SHELL']
  if (userShell) {
    const p = await shellLookupAsync(userShell, '-ilc', name, 5000)
    if (p) return p
  }

  // 4. Bash fallback — for shell=unset or broken-zsh scenarios.
  if (!userShell || !userShell.endsWith('bash')) {
    const p = await shellLookupAsync('bash', '-lc', name, 5000)
    if (p) return p
  }
  return null
}

/** Async equivalent of `cachedResolve`. Shares the same in-memory cache as
 *  the sync version, so once either resolves a binary the other returns
 *  it instantly. Path validation: cached entries are verified with a
 *  filesystem check before being returned, so a brew upgrade or manual
 *  removal triggers a re-resolve instead of leaking a stale path. */
export async function cachedResolveAsync(
  name: string,
  extras: string[] = [],
): Promise<string | null> {
  if (name in resolvedPaths) {
    const cached = resolvedPaths[name] ?? null
    if (cached === null) return null
    if (existsSync(cached)) return cached
    // Path went away — fall through to a fresh resolve.
    delete resolvedPaths[name]
  }
  const p = await resolveSystemBinaryAsync(name, extras)
  resolvedPaths[name] = p
  return p
}

/** Bulk-populate the in-memory cache from an external store (e.g. a JSON
 *  file persisted across app launches). Entries already present are left
 *  alone so a live resolve doesn't get overwritten by stale disk data. */
export function hydrateResolveCache(entries: Record<string, string | null>): void {
  for (const [name, path] of Object.entries(entries)) {
    if (!(name in resolvedPaths)) resolvedPaths[name] = path
  }
}

/** Snapshot the current cache for persistence. Returns only completed
 *  entries (resolved or definitively unresolved) — no in-flight requests. */
export function getResolveCacheSnapshot(): Record<string, string | null> {
  return { ...resolvedPaths }
}
