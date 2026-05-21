import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectSessionSource, getSessionRoots } from './source-paths.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('getSessionRoots', () => {
  test('should normalize configured profile roots to their session directories', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'spool-source-paths-'))
    tempDirs.push(baseDir)

    const workProfile = join(baseDir, 'work')
    const personalProjects = join(baseDir, 'personal', 'projects')
    mkdirSync(join(workProfile, 'projects'), { recursive: true })
    mkdirSync(personalProjects, { recursive: true })

    vi.stubEnv('SPOOL_CLAUDE_DIR', `${workProfile}\n${personalProjects}`)

    expect(getSessionRoots('claude')).toEqual([
      join(workProfile, 'projects'),
      personalProjects,
    ])
  })

  test('should normalize configured Gemini home paths to the temp directory root', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'spool-gemini-source-paths-'))
    const geminiHome = join(baseDir, '.gemini')
    tempDirs.push(baseDir)

    mkdirSync(join(geminiHome, 'tmp', 'workspace', 'chats'), { recursive: true })
    vi.stubEnv('GEMINI_CLI_HOME', baseDir)

    expect(getSessionRoots('gemini')).toEqual([
      join(geminiHome, 'tmp'),
    ])
  })

  test('should normalize explicit Gemini CLI home overrides to the chats temp root', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'spool-gemini-override-'))
    const geminiHome = join(baseDir, '.gemini')
    tempDirs.push(baseDir)

    mkdirSync(join(geminiHome, 'tmp', 'workspace', 'chats'), { recursive: true })
    vi.stubEnv('SPOOL_GEMINI_DIR', baseDir)

    expect(getSessionRoots('gemini')).toEqual([
      join(geminiHome, 'tmp'),
    ])
  })
})

describe('detectSessionSource', () => {
  test('should classify profile-backed Claude and Codex session files correctly', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'spool-source-detect-'))
    tempDirs.push(baseDir)

    const claudeRoot = join(baseDir, 'claude-work', 'projects')
    const codexRoot = join(baseDir, 'codex-personal', 'sessions')
    const geminiRoot = join(baseDir, 'gemini', 'tmp')
    mkdirSync(join(claudeRoot, 'project-a'), { recursive: true })
    mkdirSync(join(codexRoot, '2026', '03', '29'), { recursive: true })
    mkdirSync(join(geminiRoot, 'workspace', 'chats'), { recursive: true })

    const sourceRoots = {
      claude: [claudeRoot],
      codex: [codexRoot],
      gemini: [geminiRoot],
    } as const

    expect(detectSessionSource(join(claudeRoot, 'project-a', 'session.jsonl'), sourceRoots)).toBe('claude')
    expect(detectSessionSource(join(codexRoot, '2026', '03', '29', 'rollout.jsonl'), sourceRoots)).toBe('codex')
    expect(detectSessionSource(join(geminiRoot, 'workspace', 'chats', 'session-2026-04-08T00-00-deadbeef.json'), sourceRoots)).toBe('gemini')
    expect(detectSessionSource(join(baseDir, 'other', 'session.jsonl'), sourceRoots)).toBeUndefined()
  })

  test('rejects nested Claude files (subagent scratchpads) below the slug directory', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'spool-claude-nested-'))
    tempDirs.push(baseDir)

    const claudeRoot = join(baseDir, '.claude', 'projects')
    mkdirSync(join(claudeRoot, '-Users-me-spool', 'c3859389-e126-4b46-b207-63f322f41893', 'subagents'), {
      recursive: true,
    })

    const sourceRoots = {
      claude: [claudeRoot],
      codex: [join(baseDir, 'codex-empty')],
      gemini: [join(baseDir, 'gemini-empty')],
    } as const

    // Top-level session: indexed as claude.
    expect(
      detectSessionSource(
        join(claudeRoot, '-Users-me-spool', 'c3859389-e126-4b46-b207-63f322f41893.jsonl'),
        sourceRoots,
      ),
    ).toBe('claude')

    // Subagent jsonl shares the parent's sessionId — must be ignored.
    expect(
      detectSessionSource(
        join(
          claudeRoot,
          '-Users-me-spool',
          'c3859389-e126-4b46-b207-63f322f41893',
          'subagents',
          'agent-aac075d8798c35986.jsonl',
        ),
        sourceRoots,
      ),
    ).toBeUndefined()

    // Hypothetical future nested dirs (checkpoints, snapshots, etc.) are also ignored,
    // not just files literally under /subagents/.
    expect(
      detectSessionSource(
        join(claudeRoot, '-Users-me-spool', 'c3859389', 'checkpoints', 'snap.jsonl'),
        sourceRoots,
      ),
    ).toBeUndefined()
  })

  test('keeps Codex deep paths and Claude slugs containing "subagents" working', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'spool-claude-slug-edge-'))
    tempDirs.push(baseDir)

    const claudeRoot = join(baseDir, '.claude', 'projects')
    const codexRoot = join(baseDir, '.codex', 'sessions')
    // Edge case: a real project whose cwd path contains "subagents" → slug includes it.
    mkdirSync(join(claudeRoot, '-Users-me-work-subagents-app'), { recursive: true })
    mkdirSync(join(codexRoot, '2026', '05', '21'), { recursive: true })

    const sourceRoots = {
      claude: [claudeRoot],
      codex: [codexRoot],
      gemini: [join(baseDir, 'gemini-empty')],
    } as const

    // Slug with "subagents" substring must still classify as claude.
    expect(
      detectSessionSource(
        join(claudeRoot, '-Users-me-work-subagents-app', 'fffe1234-5678-90ab-cdef-000000000000.jsonl'),
        sourceRoots,
      ),
    ).toBe('claude')

    // Codex deep path (YYYY/MM/DD/rollout-*.jsonl) is unaffected by the claude rule.
    expect(
      detectSessionSource(join(codexRoot, '2026', '05', '21', 'rollout-abc.jsonl'), sourceRoots),
    ).toBe('codex')
  })
})
