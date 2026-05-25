import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useHotkeys } from '../hooks/useHotkeys.js'

type MenuItem =
  | { separator: true }
  | {
      label: string
      icon?: ReactNode
      onSelect: () => void
      active?: boolean
      disabled?: boolean
    }

type Props = {
  trigger: (params: { open: boolean; toggle: () => void }) => ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
  testId?: string
}

type Position = { top: number; left?: number; right?: number }

export default function Menu({ trigger, items, align = 'right', testId }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<Position | null>(null)

  const measure = useCallback(() => {
    const trig = triggerRef.current
    if (!trig) return
    const trigRect = trig.getBoundingClientRect()
    const menuHeight = menuRef.current?.getBoundingClientRect().height
      ?? items.length * 30 + 4
    const margin = 8
    const spaceBelow = window.innerHeight - trigRect.bottom
    const openAbove = spaceBelow < menuHeight + margin && trigRect.top > menuHeight + margin
    const top = openAbove
      ? Math.max(margin, trigRect.top - menuHeight - 4)
      : trigRect.bottom + 4
    if (align === 'right') {
      setPosition({ top, right: window.innerWidth - trigRect.right })
    } else {
      setPosition({ top, left: trigRect.left })
    }
  }, [align, items.length])

  const setMenuNode = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node
    if (node) measure()
  }, [measure])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, measure])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const close = useCallback(() => setOpen(false), [])
  useHotkeys({ Escape: close }, { active: open, modal: true })

  return (
    <div ref={triggerRef} className="inline-block" data-testid={testId}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && position && typeof document !== 'undefined' && createPortal(
        <div
          ref={setMenuNode}
          role="menu"
          style={{
            position: 'fixed',
            top: position.top,
            ...(position.right !== undefined ? { right: position.right } : {}),
            ...(position.left !== undefined ? { left: position.left } : {}),
          }}
          className="z-50 min-w-[160px] rounded-lg border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface shadow-lg overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item, index) => (
            'separator' in item ? (
              <div key={index} role="separator" className="my-1 h-px bg-warm-border dark:bg-dark-border" />
            ) : (
            <button
              key={index}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={(event) => {
                event.stopPropagation()
                if (item.disabled) return
                item.onSelect()
                setOpen(false)
              }}
              className={`group w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                item.active
                  ? 'text-accent dark:text-accent-dark bg-accent/10 dark:bg-accent-dark/10'
                  : 'text-warm-text dark:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {item.icon && (
                <span
                  className={`flex-none w-3.5 h-3.5 flex items-center justify-center transition-colors ${
                    item.active
                      ? ''
                      : 'text-warm-faint dark:text-dark-muted group-hover:text-warm-text dark:group-hover:text-dark-text'
                  }`}
                >
                  {item.icon}
                </span>
              )}
              <span className="flex-1 truncate">{item.label}</span>
            </button>
            )
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
