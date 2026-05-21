import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SessionSource } from '../types.js'

const SOURCE_DIR_NAMES: Record<Exclude<SessionSource, 'gemini'>, string> = {
  claude: 'projects',
  codex: 'sessions',
}

const SOURCE_ENV_VARS: Record<SessionSource, string> = {
  claude: 'SPOOL_CLAUDE_DIR',
  codex: 'SPOOL_CODEX_DIR',
  gemini: 'SPOOL_GEMINI_DIR',
}

const SOURCE_DEFAULT_BASES: Record<Exclude<SessionSource, 'gemini'>, string> = {
  claude: '.claude',
  codex: '.codex',
}

const SOURCE_PROFILE_BASES: Record<Exclude<SessionSource, 'gemini'>, string> = {
  claude: '.claude-profiles',
  codex: '.codex-profiles',
}

export function getSessionRoots(source: SessionSource): string[] {
  const configured = process.env[SOURCE_ENV_VARS[source]]
  if (configured) {
    return dedupePaths(splitConfiguredPaths(configured).map(path => normalizeSourceRoot(source, path)))
  }

  if (source === 'gemini') {
    return dedupePaths([normalizeSourceRoot('gemini', join(getGeminiBaseDir(), 'tmp'))])
  }

  const home = homedir()
  const childDir = SOURCE_DIR_NAMES[source]
  const roots = [join(home, SOURCE_DEFAULT_BASES[source], childDir)]
  const profilesBase = join(home, SOURCE_PROFILE_BASES[source])

  let entries: import('node:fs').Dirent<string>[] = []
  try {
    entries = readdirSync(profilesBase, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return roots
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    roots.push(join(profilesBase, entry.name, childDir))
  }

  return dedupePaths(roots)
}

export function detectSessionSource(
  filePath: string,
  sourceRoots: Record<SessionSource, string[]> = {
    claude: getSessionRoots('claude'),
    codex: getSessionRoots('codex'),
    gemini: getSessionRoots('gemini'),
  },
): SessionSource | undefined {
  for (const source of ['claude', 'codex', 'gemini'] as const) {
    if (sourceRoots[source].some(root => isSessionFileForSource(source, filePath, root))) {
      return source
    }
  }
  return undefined
}

export function getSessionWatchPatterns(
  source: SessionSource,
  roots = getSessionRoots(source),
): string[] {
  const pattern = source === 'gemini' ? 'session-*.json' : '*.jsonl'
  return roots.map(root => join(root, '**', pattern))
}

function splitConfiguredPaths(value: string): string[] {
  return value
    .split(/\r?\n/)
    .flatMap(part => part.split(delimiter))
    .map(part => part.trim())
    .filter(Boolean)
}

function normalizeSourceRoot(source: SessionSource, filePath: string): string {
  const resolvedPath = resolve(expandHome(filePath))
  if (source === 'gemini') {
    if (basename(resolvedPath) === '.gemini' || existsSync(join(resolvedPath, 'tmp'))) {
      return join(resolvedPath, 'tmp')
    }
    if (existsSync(join(resolvedPath, '.gemini', 'tmp'))) {
      return join(resolvedPath, '.gemini', 'tmp')
    }
    return resolvedPath
  }

  const childDir = SOURCE_DIR_NAMES[source]
  if (basename(resolvedPath) === childDir) return resolvedPath

  const nestedPath = join(resolvedPath, childDir)
  return existsSync(nestedPath) ? nestedPath : resolvedPath
}

function expandHome(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2))
  return filePath
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(path => resolve(expandHome(path)))))
}

function getGeminiBaseDir(): string {
  const geminiCliHome = process.env['GEMINI_CLI_HOME']?.trim()
  return geminiCliHome
    ? join(resolve(expandHome(geminiCliHome)), '.gemini')
    : join(homedir(), '.gemini')
}

export function isSessionFileForSource(source: SessionSource, filePath: string, root: string): boolean {
  if (!isWithinRoot(filePath, root)) return false
  if (source === 'gemini') {
    return filePath.endsWith('.json')
      && basename(filePath).startsWith('session-')
      && /(?:^|\/)chats\//.test(filePath)
  }
  if (!filePath.endsWith('.jsonl')) return false
  if (source === 'claude') {
    // Claude sessions live at <root>/<slug>/<uuid>.jsonl — exactly two segments
    // relative to root. Nested files (e.g. <slug>/<uuid>/subagents/agent-*.jsonl)
    // are subagent scratchpads that share the parent's sessionId; indexing them
    // clobbers the parent row via UNIQUE(session_uuid) and zeros message_count.
    const rel = relative(root, filePath)
    return rel.length > 0 && rel.split(sep).length === 2
  }
  return true
}

function isWithinRoot(filePath: string, root: string): boolean {
  const resolvedFile = resolve(filePath)
  const resolvedRoot = resolve(root)
  const rel = relative(resolvedRoot, resolvedFile)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
