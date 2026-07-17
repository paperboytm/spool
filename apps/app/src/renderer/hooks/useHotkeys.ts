import { useEffect, useRef } from 'react'

// Stack-based hotkey dispatcher.
//
// - Top layer is consulted first; first match wins.
// - A `modal` layer also blocks unbound combos from falling through to lower
//   layers (so opening Settings suppresses global ⌘K, etc.).
// - `mod` resolves to ⌘ on macOS and Ctrl elsewhere.
// - A `skipInEditable` layer is bypassed entirely when the event target is an
//   <input>, <textarea>, or contenteditable — that lets ⌘Z in a text field
//   fall through to the browser's native undo instead of triggering the
//   editor's state undo.
// - Bindings can target either `event.key` (the printed character — layout-
//   dependent) or `event.code` via a `code:<name>` token (layout-independent;
//   covers numpad equivalents). Each keydown is matched against both forms.

type Handler = (event: KeyboardEvent) => void
type Bindings = Record<string, Handler>
export type HotkeyLayer = {
  bindingsRef: { current: Bindings }
  modalRef: { current: boolean }
  skipInEditableRef: { current: boolean }
}

const stack: HotkeyLayer[] = []
let installed = false

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  ' ': 'space',
  '=': 'equal',
  '+': 'plus',
  '-': 'minus',
  zero: '0',
}

const MODIFIER_ORDER = ['ctrl', 'meta', 'alt', 'shift']

const CODE_PREFIX = 'code:'

function normalizePart(part: string, mac: boolean): string {
  const p = part.trim().toLowerCase()
  if (p === 'mod') return mac ? 'meta' : 'ctrl'
  if (p === 'cmd' || p === 'command') return 'meta'
  if (p === 'control') return 'ctrl'
  if (p === 'option' || p === 'opt') return 'alt'
  if (p.startsWith(CODE_PREFIX)) return CODE_PREFIX + p.slice(CODE_PREFIX.length)
  return KEY_ALIASES[p] ?? p
}

function sortParts(parts: string[]): string[] {
  return [...parts].sort((a, b) => {
    const ai = MODIFIER_ORDER.indexOf(a)
    const bi = MODIFIER_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

export function normalizeCombo(combo: string, mac: boolean = isMac): string {
  return sortParts(combo.split('+').map((p) => normalizePart(p, mac))).join('+')
}

type EventLike = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'> & {
  code?: string
}

const MODIFIER_CODE_RE = /^(Control|Meta|Alt|Shift|OS)(Left|Right)?$/

export function eventToCombos(event: EventLike): string[] {
  const mods: string[] = []
  if (event.ctrlKey) mods.push('ctrl')
  if (event.metaKey) mods.push('meta')
  if (event.altKey) mods.push('alt')
  if (event.shiftKey) mods.push('shift')

  const combos: string[] = []

  // Key-based combo. Skip when the printed key IS the modifier (e.g. user
  // pressed ⌘ alone — `event.key === 'Meta'`).
  const keyRaw = event.key.toLowerCase()
  if (!['control', 'meta', 'alt', 'shift'].includes(keyRaw)) {
    const key = KEY_ALIASES[keyRaw] ?? keyRaw
    combos.push(sortParts([...mods, key]).join('+'))
  }

  // Code-based combo. Useful when the desired binding is layout-independent
  // (Equal, Minus, Digit0) or numpad-only (NumpadAdd, Numpad0).
  const code = event.code
  if (code && !MODIFIER_CODE_RE.test(code)) {
    combos.push(sortParts([...mods, CODE_PREFIX + code.toLowerCase()]).join('+'))
  }

  return combos
}

export type DispatchResult =
  | { kind: 'handled'; layerIndex: number; handler: Handler }
  | { kind: 'swallowed' }
  | { kind: 'unhandled' }

export function dispatchHotkey(
  combos: string[],
  layers: HotkeyLayer[],
  inEditable: boolean = false,
): DispatchResult {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (!layer) continue
    // A layer that opted into editable-skip is invisible when focus is in a
    // text field — control flows to the layer below as if this one weren't
    // mounted at all, modal flag included.
    if (inEditable && layer.skipInEditableRef.current) continue
    for (const combo of combos) {
      const handler = layer.bindingsRef.current[combo]
      if (handler) return { kind: 'handled', layerIndex: i, handler }
    }
    if (layer.modalRef.current) return { kind: 'swallowed' }
  }
  return { kind: 'unhandled' }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

function install() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (event) => {
    const combos = eventToCombos(event)
    const result = dispatchHotkey(combos, stack, isEditableTarget(event.target))
    if (result.kind === 'handled') {
      event.preventDefault()
      result.handler(event)
    }
  })
}

export function useHotkeys(
  bindings: Bindings,
  options: { active?: boolean; modal?: boolean; skipInEditable?: boolean } = {},
) {
  const { active = true, modal = false, skipInEditable = false } = options

  const bindingsRef = useRef<Bindings>({})
  const next: Bindings = {}
  for (const [combo, handler] of Object.entries(bindings)) {
    next[normalizeCombo(combo)] = handler
  }
  bindingsRef.current = next

  const modalRef = useRef(modal)
  modalRef.current = modal

  const skipInEditableRef = useRef(skipInEditable)
  skipInEditableRef.current = skipInEditable

  useEffect(() => {
    if (!active) return
    install()
    const layer: HotkeyLayer = { bindingsRef, modalRef, skipInEditableRef }
    stack.push(layer)
    return () => {
      const i = stack.lastIndexOf(layer)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
