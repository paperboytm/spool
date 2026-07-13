// Static catalog of user-visible keyboard shortcuts, grouped by context.
//
// `combo` uses the same syntax as `useHotkeys`: `mod` resolves to ⌘ on
// macOS and Ctrl elsewhere. Multiple alternative bindings for a single
// action are comma-separated (e.g. "arrowup,arrowdown") and rendered
// side-by-side.

export type ShortcutEntry = {
  /** i18n suffix — `settings.shortcuts_action_<id>` */
  id: string
  /** Combo string(s); comma-separates alternatives. */
  combo: string
}

export type ShortcutGroup = {
  /** i18n suffix — `settings.shortcuts_group_<id>` */
  id: string
  shortcuts: ShortcutEntry[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
      id: 'global',
      shortcuts: [
        { id: 'search', combo: 'mod+k' },
        { id: 'toggleSidebar', combo: 'mod+b' },
      ],
    },
    {
      id: 'search',
      shortcuts: [
        { id: 'navigate', combo: 'arrowup,arrowdown' },
        { id: 'open', combo: 'enter' },
        { id: 'runQuery', combo: 'shift+enter' },
        { id: 'toggleScope', combo: 'tab' },
        { id: 'close', combo: 'escape' },
      ],
    },
    {
      id: 'session',
      shortcuts: [
        { id: 'find', combo: 'mod+f' },
        { id: 'prevNextMatch', combo: 'mod+arrowleft,mod+arrowright' },
        { id: 'closeFind', combo: 'escape' },
      ],
    },
    {
      id: 'shareEditor',
      shortcuts: [
        { id: 'undo', combo: 'mod+z' },
        { id: 'redo', combo: 'mod+shift+z' },
        { id: 'zoomIn', combo: 'mod+plus' },
        { id: 'zoomOut', combo: 'mod+minus' },
        { id: 'zoomFit', combo: 'mod+0' },
        { id: 'pan', combo: 'space' },
      ],
    },
]

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
}

const PC_SYMBOLS: Record<string, string> = {
  mod: 'Ctrl',
  meta: 'Win',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
}

const KEY_SYMBOLS: Record<string, string> = {
  enter: '↵',
  escape: 'esc',
  tab: '⇥',
  space: 'space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  plus: '+',
  minus: '−',
}

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'mod', 'meta']

export function formatComboParts(combo: string, isMac: boolean): string[] {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase())
  const symbols = isMac ? MAC_SYMBOLS : PC_SYMBOLS
  const sorted = [...parts].sort((a, b) => {
    const ai = MODIFIER_ORDER.indexOf(a)
    const bi = MODIFIER_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  return sorted.map((p) => {
    if (symbols[p]) return symbols[p]
    if (KEY_SYMBOLS[p]) return KEY_SYMBOLS[p]
    return p.length === 1 ? p.toUpperCase() : p
  })
}

export function splitAlternatives(combo: string): string[] {
  return combo.split(',').map((c) => c.trim()).filter(Boolean)
}
