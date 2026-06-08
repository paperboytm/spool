import { useEffect, useRef } from 'react'

/**
 * Trap Tab/Shift+Tab focus inside the container while `active` is true,
 * and restore focus to the previously-focused element when the trap
 * tears down.
 *
 * Used by destructive modals (UnpublishConfirmModal, DeleteAccountConfirmModal)
 * where `aria-modal="true"` is a hint to assistive tech but the browser
 * itself doesn't actually contain focus — keyboard users can Tab out of
 * the modal into the underlying page, which on a confirmation surface is
 * a real footgun (the next Tab might land on a destructive control the
 * user never saw).
 *
 * Returns a ref to attach to the trap root. The hook auto-focuses
 * `initialFocusRef.current` (preferred) or the first focusable element
 * when the trap activates.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  active: boolean,
  initialFocusRef?: React.RefObject<HTMLElement | null>,
): React.RefObject<T | null> {
  const rootRef = useRef<T | null>(null)
  const lastActiveRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!active) return
    lastActiveRef.current = document.activeElement
    const root = rootRef.current
    if (!root) return

    // Focus the explicit initial target (e.g. Cancel button on a
    // destructive confirm) so the user isn't one keypress away from
    // committing the destructive action.
    const initial = initialFocusRef?.current
    if (initial) {
      initial.focus()
    } else {
      const first = focusable(root)[0]
      first?.focus()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusable(root)
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      const current = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (current === first || !root.contains(current)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (current === last || !root.contains(current)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const restore = lastActiveRef.current
      if (restore instanceof HTMLElement) restore.focus()
    }
  }, [active, initialFocusRef])

  return rootRef
}

// Standard focusable selectors. Skip disabled / aria-hidden / tabindex=-1.
const SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusable(root: HTMLElement): HTMLElement[] {
  // Both predicates must hold to be included:
  //   - element is laid out (non-zero box). offsetParent === null is
  //     the standard "hidden" check for absolutely-positioned elements,
  //     but it ALSO returns null for `position: fixed`, which our modal
  //     overlay uses. Switch to offsetWidth/offsetHeight which work for
  //     all positioning schemes.
  //   - element is NOT aria-hidden. Was previously OR'd with offset
  //     check via ||, which let aria-hidden elements with a visible
  //     parent slip through as tab-stops.
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter(
    (el) => el.offsetWidth > 0 && el.offsetHeight > 0 && el.getAttribute('aria-hidden') !== 'true',
  )
}
