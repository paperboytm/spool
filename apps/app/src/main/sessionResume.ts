import { existsSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { homedir } from 'node:os'
import { decodeProjectSlug, type Session } from '@spool-lab/core'

type ResumeSessionContext = Pick<Session, 'source' | 'cwd' | 'projectDisplayPath' | 'filePath'>

export function resolveResumeWorkingDirectory(session: ResumeSessionContext): string | undefined {
  const cwd = normalizePath(session.cwd)
  if (isUsableDirectory(cwd)) return cwd

  if (session.source === 'claude') {
    const decodedSlugPath = decodeClaudeProjectPath(session.filePath)
    if (isUsableDirectory(decodedSlugPath)) return decodedSlugPath
  }

  const projectPath = normalizePath(session.projectDisplayPath)
  if (isUsableDirectory(projectPath)) return projectPath

  return undefined
}

function decodeClaudeProjectPath(filePath: string): string | undefined {
  const slug = basename(dirname(filePath))
  const decoded = normalizePath(decodeProjectSlug(slug))
  if (!decoded || !decoded.startsWith('/')) return undefined
  return decoded
}

function normalizePath(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/^~(?=\/|$)/, homedir())
}

function isUsableDirectory(value: string | undefined): value is string {
  if (!value) return false
  try {
    return existsSync(value) && statSync(value).isDirectory()
  } catch {
    return false
  }
}
