// Fork-first: every continue command branches a NEW session, so the
// original transcript is never appended to (plain `claude --resume`
// interleaves two terminals into one file; `codex resume` appends the
// rollout in place). Gemini CLI has no fork affordance — plain --resume
// is the only option there. pi resolves the uuid globally but creates
// the fork under the CURRENT project, so the cd prefix also decides
// where the branch lands.
const RESUME_COMMAND_TEMPLATES: Record<string, { prefix: string; suffix?: string }> = {
  claude: { prefix: 'claude --resume', suffix: '--fork-session' },
  codex: { prefix: 'codex fork' },
  gemini: { prefix: 'gemini --resume' },
  opencode: { prefix: 'opencode --session', suffix: '--fork' },
  pi: { prefix: 'pi --fork' },
}

export function getSessionResumeCommandPrefix(source: string): string | null {
  return RESUME_COMMAND_TEMPLATES[source]?.prefix ?? null
}

export function getSessionResumeCommand(source: string, sessionUuid: string, cwd?: string | null): string | null {
  const template = RESUME_COMMAND_TEMPLATES[source]
  if (!template) return null
  const base = [template.prefix, shellQuote(sessionUuid), template.suffix]
    .filter(Boolean)
    .join(' ')
  return cwd ? `cd ${shellQuote(cwd)} && ${base}` : base
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
