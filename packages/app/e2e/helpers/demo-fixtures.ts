/**
 * Build programmatic Claude / Codex / Gemini fixture files for a release demo.
 *
 * Different from the static fixtures in `e2e/fixtures/` — those are for the
 * regular test suite. This builder is for release video captures where you
 * want to shape exactly which projects, session titles, and counts the
 * Library view shows.
 *
 * Pass in a `ProjectSeed[]` describing the projects you want to demo, plus
 * filler topics for padding. Each release writes its own seed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type SessionSource = 'claude' | 'codex'

export interface LeadSession {
  title: string
  source: SessionSource
  /** ISO 8601 timestamp. Determines sort order in Recent. */
  iso: string
  /** Optional explicit turn list. When omitted, the default 2-turn stub is
   *  used (`Help me with: <title>` + a single assistant reply). Provide
   *  this to demo a richer conversation in the share editor. Each turn's
   *  timestamp is derived from `iso + (i * 30s)`. */
  turns?: Array<{ role: 'user' | 'assistant'; text: string }>
}

export interface ProjectSeed {
  /** Project name as shown in sidebar. */
  name: string
  /** Total sessions to show in the count badge. Includes fillers. */
  total: number
  /** Real session titles that appear at the top of the project + in Recent. */
  leadSessions: LeadSession[]
  /** Round-robin sources used to pad up to `total`. */
  fillerSources: SessionSource[]
}

export interface BuildDemoFixturesOptions {
  /** Filler session titles cycled to pad up to each project's `total`. */
  fillerTopics?: string[]
  /** Counter start for synthetic UUIDs. Defaults to 1. */
  sessionCounterStart?: number
}

const DEFAULT_FILLER_TOPICS = [
  'Polish sidebar density',
  'Tighten the library row hit-area',
  'Review folder icon balance in the nav',
  'Confirm title truncation stays graceful',
  'Stress-test recent buckets after sync',
  'Compare pinned ordering with production data',
  'Tune footer status alignment',
  'Refine session meta rhythm in dark mode',
  'Check contrast of muted metadata labels',
  'Prepare a clean first-run screenshot set',
]

/** Build a deterministic synthetic UUID for fixture session IDs. */
function toUuid(counter: number): string {
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
}

function workspacePath(tmpDir: string, name: string): string {
  void tmpDir
  return `/Users/demo/Code/${name}`
}

function fixtureWorkspaceDir(tmpDir: string, name: string): string {
  return join(tmpDir, 'workspaces', name)
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

function writeText(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value, 'utf8')
}

function makeClaudeSession(
  sessionId: string,
  cwd: string,
  title: string,
  iso: string,
  turns?: Array<{ role: 'user' | 'assistant'; text: string }>,
): string {
  const lines: string[] = [
    JSON.stringify({
      type: 'custom-title',
      sessionId,
      cwd,
      customTitle: title,
    }),
  ]

  const dialog = turns ?? [
    { role: 'user' as const, text: `Help me with: ${title}` },
    {
      role: 'assistant' as const,
      text: `Working through ${title} with the latest shell and sidebar assumptions.`,
    },
  ]

  let parentUuid: string | undefined
  dialog.forEach((turn, i) => {
    const uuid = `${sessionId}-${turn.role[0]}${i + 1}`
    const timestamp = new Date(Date.parse(iso) + i * 30_000).toISOString()
    const entry: Record<string, unknown> = {
      type: turn.role,
      sessionId,
      cwd,
      uuid,
      timestamp,
      message:
        turn.role === 'user'
          ? { role: 'user', content: turn.text }
          : {
              role: 'assistant',
              model: 'claude-sonnet-4.20250514',
              content: [{ type: 'text', text: turn.text }],
            },
    }
    if (parentUuid) entry.parentUuid = parentUuid
    lines.push(JSON.stringify(entry))
    parentUuid = uuid
  })

  return lines.join('\n') + '\n'
}

function makeCodexSession(sessionId: string, cwd: string, title: string, iso: string): string {
  const t0 = new Date(Date.parse(iso) + 2_000).toISOString()
  const t1 = new Date(Date.parse(iso) + 10_000).toISOString()
  return [
    JSON.stringify({
      timestamp: iso,
      type: 'session_meta',
      payload: { id: sessionId, cwd },
    }),
    JSON.stringify({
      timestamp: t0,
      type: 'turn_context',
      payload: { model: 'gpt-5.4', cwd },
    }),
    JSON.stringify({
      timestamp: t0,
      type: 'event_msg',
      payload: { type: 'user_message', message: title },
    }),
    JSON.stringify({
      timestamp: t1,
      type: 'event_msg',
      payload: { type: 'agent_message', message: `Shaping a rollout plan for ${title}.` },
    }),
  ].join('\n') + '\n'
}

/**
 * Materialize Claude/Codex/Gemini fixture files under `tmpDir` shaped by the
 * given project seed. The caller is responsible for setting the matching
 * SPOOL_*_DIR env vars when launching Electron.
 */
export function buildDemoFixtures(
  tmpDir: string,
  projects: ProjectSeed[],
  options: BuildDemoFixturesOptions = {},
): void {
  const claudeDir = join(tmpDir, 'claude', 'projects')
  const codexDir = join(tmpDir, 'codex', 'sessions')
  const geminiHome = join(tmpDir, 'gemini-cli-home')
  const dataDir = join(tmpDir, 'data')

  const fillerTopics = options.fillerTopics ?? DEFAULT_FILLER_TOPICS
  let sessionCounter = options.sessionCounterStart ?? 1
  let fillerTitleIndex = 0

  mkdirSync(claudeDir, { recursive: true })
  mkdirSync(codexDir, { recursive: true })
  mkdirSync(join(geminiHome, '.gemini'), { recursive: true })
  mkdirSync(dataDir, { recursive: true })

  writeJson(join(dataDir, 'ui.json'), {
    themeSource: 'dark',
    sidebarCollapsed: false,
  })
  writeJson(join(geminiHome, '.gemini', 'projects.json'), { projects: {} })

  for (const project of projects) {
    const cwd = workspacePath(tmpDir, project.name)
    mkdirSync(fixtureWorkspaceDir(tmpDir, project.name), { recursive: true })

    const sessions: LeadSession[] = [...project.leadSessions]
    const fillerCount = Math.max(0, project.total - project.leadSessions.length)
    for (let i = 0; i < fillerCount; i += 1) {
      const source = project.fillerSources[i % project.fillerSources.length]
      const dayOffset = 3 + Math.floor(i / 4)
      const hour = 17 - (i % 6)
      const minute = (i * 7) % 60
      const topicIndex = fillerTitleIndex % fillerTopics.length
      const wrapCount = Math.floor(fillerTitleIndex / fillerTopics.length)
      const topic = fillerTopics[topicIndex] ?? `Follow-up task ${fillerTitleIndex + 1}`
      const title = wrapCount > 0 ? `${topic} ${wrapCount + 1}` : topic
      sessions.push({
        title,
        source,
        iso: new Date(Date.UTC(2026, 4, Math.max(1, 10 - dayOffset), hour, minute, 0)).toISOString(),
      })
      fillerTitleIndex += 1
    }

    sessions.forEach((session, index) => {
      const sessionId = toUuid(sessionCounter++)
      if (session.source === 'claude') {
        const relDir = join(claudeDir, project.name.toLowerCase())
        const filePath = join(relDir, `${project.name.toLowerCase()}-${String(index + 1).padStart(3, '0')}.jsonl`)
        writeText(filePath, makeClaudeSession(sessionId, cwd, session.title, session.iso, session.turns))
        return
      }

      const date = new Date(session.iso)
      const relDir = join(
        codexDir,
        String(date.getUTCFullYear()),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0'),
      )
      const slug = `rollout-${session.iso.replace(/:/g, '-').replace('.000Z', 'Z')}-${sessionId}.jsonl`
      const filePath = join(relDir, slug)
      writeText(filePath, makeCodexSession(sessionId, cwd, session.title, session.iso))
    })
  }
}
