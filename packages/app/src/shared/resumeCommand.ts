const RESUME_COMMAND_PREFIXES: Record<string, string> = {
  claude: 'claude --resume',
  codex: 'codex resume',
  gemini: 'gemini --resume',
  antigravity: 'agy --conversation',
  opencode: 'opencode --session',
}

export function getSessionResumeCommandPrefix(source: string): string | null {
  return RESUME_COMMAND_PREFIXES[source] ?? null
}

export function getSessionResumeCommand(source: string, sessionUuid: string, cwd?: string | null): string | null {
  const prefix = getSessionResumeCommandPrefix(source)
  if (!prefix) return null
  const base = `${prefix} ${shellQuote(sessionUuid)}`
  return cwd ? `cd ${shellQuote(cwd)} && ${base}` : base
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
