import { describe, it, expect } from 'vitest'
import {
  normalizeCombo,
  eventToCombos,
  dispatchHotkey,
  type HotkeyLayer,
} from './useHotkeys.js'

function layer(
  bindings: Record<string, () => void>,
  opts: { modal?: boolean; skipInEditable?: boolean } = {},
): HotkeyLayer {
  return {
    bindingsRef: { current: bindings },
    modalRef: { current: opts.modal ?? false },
    skipInEditableRef: { current: opts.skipInEditable ?? false },
  }
}

describe('normalizeCombo', () => {
  it('lowercases and sorts modifiers consistently', () => {
    expect(normalizeCombo('Shift+Meta+K', true)).toBe('meta+shift+k')
    expect(normalizeCombo('K+Meta+Shift', true)).toBe('meta+shift+k')
  })

  it('resolves `mod` to meta on mac, ctrl elsewhere', () => {
    expect(normalizeCombo('mod+k', true)).toBe('meta+k')
    expect(normalizeCombo('mod+k', false)).toBe('ctrl+k')
  })

  it('accepts alias modifiers', () => {
    expect(normalizeCombo('cmd+k', true)).toBe('meta+k')
    expect(normalizeCombo('command+k', true)).toBe('meta+k')
    expect(normalizeCombo('control+k', false)).toBe('ctrl+k')
    expect(normalizeCombo('option+k', true)).toBe('alt+k')
  })

  it('aliases arrow + esc keys', () => {
    expect(normalizeCombo('mod+left', true)).toBe('meta+arrowleft')
    expect(normalizeCombo('Esc', true)).toBe('escape')
  })

  it('aliases printable-symbol names that would clash with the + separator', () => {
    expect(normalizeCombo('mod+plus', true)).toBe('meta+plus')
    expect(normalizeCombo('mod+minus', true)).toBe('meta+minus')
    expect(normalizeCombo('mod+equal', true)).toBe('meta+equal')
  })

  it('preserves code:NAME tokens for layout-independent matching', () => {
    expect(normalizeCombo('mod+code:Equal', true)).toBe('meta+code:equal')
    expect(normalizeCombo('mod+code:NumpadAdd', true)).toBe('meta+code:numpadadd')
  })
})

describe('eventToCombos', () => {
  it('builds combo string from KeyboardEvent fields', () => {
    expect(eventToCombos({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'k',
    })).toContain('meta+k')
  })

  it('omits the key-based combo when a modifier was the only key pressed', () => {
    expect(eventToCombos({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'Meta',
    })).toEqual([])
  })

  it('orders modifiers same as normalizeCombo so they match', () => {
    const event = { ctrlKey: false, metaKey: true, altKey: false, shiftKey: true, key: 'K' }
    expect(eventToCombos(event)).toContain(normalizeCombo('mod+shift+k', true))
  })

  it('aliases ArrowLeft → arrowleft', () => {
    expect(eventToCombos({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'ArrowLeft',
    })).toContain('meta+arrowleft')
  })

  it('emits a code:NAME variant alongside the key-based combo', () => {
    const combos = eventToCombos({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: '=', code: 'Equal',
    })
    expect(combos).toContain('meta+equal')
    expect(combos).toContain('meta+code:equal')
  })

  it('emits a code:NAME variant for numpad keys whose printed key matches the numeric row', () => {
    const combos = eventToCombos({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: '+', code: 'NumpadAdd',
    })
    expect(combos).toContain('meta+plus')
    expect(combos).toContain('meta+code:numpadadd')
  })

  it('skips emitting a code-based combo when only modifier keys are pressed', () => {
    const combos = eventToCombos({
      ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'Meta', code: 'MetaLeft',
    })
    expect(combos).toEqual([])
  })
})

describe('dispatchHotkey', () => {
  it('returns the matching handler from the top layer', () => {
    const fn = () => {}
    const result = dispatchHotkey(['escape'], [layer({ escape: fn })])
    expect(result).toEqual({ kind: 'handled', layerIndex: 0, handler: fn })
  })

  it('top layer wins over lower layer for the same combo', () => {
    const lower = () => {}
    const upper = () => {}
    const result = dispatchHotkey(['escape'], [
      layer({ escape: lower }),
      layer({ escape: upper }),
    ])
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.handler).toBe(upper)
      expect(result.layerIndex).toBe(1)
    }
  })

  it('falls through to lower layer when top has no binding (non-modal)', () => {
    const lower = () => {}
    const result = dispatchHotkey(['meta+k'], [
      layer({ 'meta+k': lower }),
      layer({ escape: () => {} }),
    ])
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.handler).toBe(lower)
      expect(result.layerIndex).toBe(0)
    }
  })

  it('modal layer swallows unbound combos so they do not fall through', () => {
    const lower = () => {}
    const result = dispatchHotkey(['meta+k'], [
      layer({ 'meta+k': lower }),
      layer({ escape: () => {} }, { modal: true }),
    ])
    expect(result).toEqual({ kind: 'swallowed' })
  })

  it('modal layer still serves its own bindings before swallowing', () => {
    const lowerFn = () => {}
    const modalEsc = () => {}
    const result = dispatchHotkey(['escape'], [
      layer({ 'meta+k': lowerFn }),
      layer({ escape: modalEsc }, { modal: true }),
    ])
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') expect(result.handler).toBe(modalEsc)
  })

  it('returns unhandled when no layer binds the combo', () => {
    const result = dispatchHotkey(['meta+x'], [layer({ escape: () => {} })])
    expect(result).toEqual({ kind: 'unhandled' })
  })

  it('returns unhandled on empty stack', () => {
    expect(dispatchHotkey(['escape'], [])).toEqual({ kind: 'unhandled' })
  })

  it('tries each emitted combo until one matches', () => {
    const fn = () => {}
    const result = dispatchHotkey(['meta+equal', 'meta+code:equal'], [
      layer({ 'meta+code:equal': fn }),
    ])
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') expect(result.handler).toBe(fn)
  })

  describe('skipInEditable', () => {
    it('skips the layer entirely when focus is in an editable and the layer opted in', () => {
      const fn = () => {}
      const result = dispatchHotkey(
        ['meta+z'],
        [layer({ 'meta+z': fn }, { skipInEditable: true })],
        true,
      )
      expect(result.kind).toBe('unhandled')
    })

    it('still handles the combo on a skipInEditable layer when focus is NOT editable', () => {
      const fn = () => {}
      const result = dispatchHotkey(
        ['meta+z'],
        [layer({ 'meta+z': fn }, { skipInEditable: true })],
        false,
      )
      expect(result.kind).toBe('handled')
    })

    it('lets a non-skipping lower layer still handle when top opted out via editable focus', () => {
      const lower = () => {}
      const result = dispatchHotkey(
        ['meta+z'],
        [
          layer({ 'meta+z': lower }),
          layer({ 'meta+z': () => {} }, { skipInEditable: true }),
        ],
        true,
      )
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') expect(result.handler).toBe(lower)
    })

    it('does NOT count a skipped layer as a modal barrier — combos pass through to lower layers', () => {
      const lower = () => {}
      const result = dispatchHotkey(
        ['meta+k'],
        [
          layer({ 'meta+k': lower }),
          layer({ escape: () => {} }, { modal: true, skipInEditable: true }),
        ],
        true,
      )
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') expect(result.handler).toBe(lower)
    })
  })
})
