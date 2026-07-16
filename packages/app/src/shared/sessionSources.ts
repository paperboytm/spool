const SESSION_SOURCE_META = {
  claude: {
    label: 'Claude Code',
    shortLabel: 'claude',
    color: '#C26A4E',
    colorDark: '#E89A7C',
  },
  codex: {
    label: 'Codex CLI',
    shortLabel: 'codex',
    color: '#4A9670',
    colorDark: '#7CC9A2',
  },
  gemini: {
    label: 'Gemini CLI',
    shortLabel: 'gemini',
    color: '#5887D0',
    colorDark: '#8AB0E5',
  },
  antigravity: {
    label: 'Antigravity',
    shortLabel: 'agy',
    color: '#6B5CA5',
    colorDark: '#9B8FD0',
  },
  opencode: {
    label: 'OpenCode',
    shortLabel: 'opencode',
    color: '#8A6F3D',
    colorDark: '#C9A761',
  },
} as const

export function getSessionSourceColor(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.color ?? '#888888'
}

export function getSessionSourceColorDark(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.colorDark ?? '#A8A8A0'
}

export function getSessionSourceLabel(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.label ?? source
}

export function getSessionSourceShortLabel(source: string): string {
  return SESSION_SOURCE_META[source as keyof typeof SESSION_SOURCE_META]?.shortLabel ?? source
}
