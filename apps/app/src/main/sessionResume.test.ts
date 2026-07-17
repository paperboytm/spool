import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveResumeWorkingDirectory } from './sessionResume.js'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('resolveResumeWorkingDirectory', () => {
  it('uses the stored cwd when it points to an existing directory', () => {
    const cwd = makeTempDir('spool-resume-cwd-')

    expect(resolveResumeWorkingDirectory({
      source: 'claude',
      cwd,
      projectDisplayPath: '/unused/project',
      filePath: '/Users/test/.claude/projects/-Users-test-project/session.jsonl',
    })).toBe(cwd)

    rmSync(cwd, { recursive: true, force: true })
  })

  it('falls back to the decoded Claude project slug when cwd is missing', () => {
    const root = makeTempDir('spoolresumeclaude')
    const projectDir = join(root, 'workspace')
    mkdirSync(projectDir, { recursive: true })
    const slug = `-${projectDir.slice(1).replace(/\//g, '-')}`
    const filePath = join(root, '.claude', 'projects', slug, 'session.jsonl')
    mkdirSync(join(root, '.claude', 'projects', slug), { recursive: true })

    expect(resolveResumeWorkingDirectory({
      source: 'claude',
      cwd: '',
      projectDisplayPath: 'workspace',
      filePath,
    })).toBe(projectDir)

    rmSync(root, { recursive: true, force: true })
  })

  it('falls back to projectDisplayPath when cwd is unusable', () => {
    const projectDir = makeTempDir('spool-resume-project-')

    expect(resolveResumeWorkingDirectory({
      source: 'codex',
      cwd: '/path/that/does/not/exist',
      projectDisplayPath: projectDir,
      filePath: '/Users/test/.codex/sessions/2026/04/05/rollout.jsonl',
    })).toBe(projectDir)

    rmSync(projectDir, { recursive: true, force: true })
  })

  it('returns undefined when no usable working directory is available', () => {
    expect(resolveResumeWorkingDirectory({
      source: 'codex',
      cwd: '/path/that/does/not/exist',
      projectDisplayPath: '/another/missing/path',
      filePath: '/Users/test/.codex/sessions/2026/04/05/rollout.jsonl',
    })).toBeUndefined()
  })

  it('uses the Gemini project display path when cwd is unavailable', () => {
    const projectDir = makeTempDir('spool-resume-gemini-')

    expect(resolveResumeWorkingDirectory({
      source: 'gemini',
      cwd: '',
      projectDisplayPath: projectDir,
      filePath: '/Users/test/.gemini/tmp/workspace/chats/session-2026-04-08T00-00-deadbeef.json',
    })).toBe(projectDir)

    rmSync(projectDir, { recursive: true, force: true })
  })
})
