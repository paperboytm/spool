import { Avatar } from '@spool-lab/ui'
import { FolderKanban, Library, LogOut, Moon, Sun, UserRound, Users } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { signOut } from '../lib/api'
import { readThemeAttr, writeThemeAttr } from '../lib/theme'

import '../styles/account-menu.css'

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled])'
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function accountMenuTargetIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount
  if (key === 'ArrowUp')
    return currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount
  return null
}

function menuItems(panel: HTMLElement | null): HTMLElement[] {
  return panel === null ? [] : Array.from(panel.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR))
}

function moveFocusOutsideMenu(
  root: HTMLElement | null,
  trigger: HTMLButtonElement | null,
  backwards: boolean,
) {
  if (root === null || trigger === null) return
  const focusable = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (candidate) => candidate === trigger || candidate.getClientRects().length > 0,
  )
  const triggerIndex = focusable.indexOf(trigger)
  const direction = backwards ? -1 : 1

  for (
    let index = triggerIndex + direction;
    index >= 0 && index < focusable.length;
    index += direction
  ) {
    const candidate = focusable[index]!
    if (!root.contains(candidate)) {
      candidate.focus()
      return
    }
  }

  trigger.focus()
}

/**
 * The avatar is the single identity entry point in every header: primary
 * navigation stays on the left, Publish stays the lone action on the right,
 * and everything account-shaped (library, Teams, theme, sign out) lives
 * behind this menu instead of competing for header width.
 */
export function AccountMenu({
  name,
  src,
  contextTeam,
}: {
  name: string | null
  src?: string | null
  contextTeam?: { href: string; label: string }
}) {
  const displayName = name ?? 'Your account'
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<'first' | 'last'>('first')
  const id = useId().replace(/:/g, '')
  const panelId = `account-menu-panel-${id}`

  useEffect(() => {
    if (!open) return
    const items = menuItems(panelRef.current)
    items[initialFocusRef.current === 'last' ? items.length - 1 : 0]?.focus()
    initialFocusRef.current = 'first'

    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (root && event.target && !root.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        setOpen(false)
        moveFocusOutsideMenu(rootRef.current, triggerRef.current, event.shiftKey)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="account-menu" ref={rootRef} data-state={open ? 'open' : 'closed'}>
      <button
        ref={triggerRef}
        type="button"
        className="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open account menu"
        title={displayName}
        onClick={() => {
          initialFocusRef.current = 'first'
          setOpen((value) => !value)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
          setOpen(true)
        }}
      >
        <Avatar src={src ?? null} name={displayName} alt="" size="md" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="account-menu-panel"
          id={panelId}
          role="menu"
          aria-label="Account"
          onKeyDown={(event) => {
            const items = menuItems(event.currentTarget)
            const currentIndex = items.indexOf(document.activeElement as HTMLElement)
            const targetIndex = accountMenuTargetIndex(event.key, currentIndex, items.length)
            if (targetIndex === null) return
            event.preventDefault()
            items[targetIndex]?.focus()
          }}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
          }}
        >
          <p className="account-menu-name" aria-hidden="true">
            {displayName}
          </p>
          <a role="menuitem" tabIndex={-1} className="account-menu-item" href="/me">
            <UserRound size={14} strokeWidth={1.7} aria-hidden="true" />
            Account
          </a>
          <a role="menuitem" tabIndex={-1} className="account-menu-item" href="/my-sessions">
            <Library size={14} strokeWidth={1.7} aria-hidden="true" />
            My Sessions
          </a>
          <a
            role="menuitem"
            tabIndex={-1}
            className="account-menu-item"
            href="/projects?scope=mine"
          >
            <FolderKanban size={14} strokeWidth={1.7} aria-hidden="true" />
            My Projects
          </a>
          <a
            role="menuitem"
            tabIndex={-1}
            className="account-menu-item"
            href={contextTeam?.href ?? '/teams'}
            {...(contextTeam ? { title: `Open ${contextTeam.label}` } : {})}
          >
            <Users size={14} strokeWidth={1.7} aria-hidden="true" />
            {contextTeam?.label ?? 'Teams'}
          </a>
          <div className="account-menu-divider" role="separator" />
          <AccountMenuThemeItem />
          <div className="account-menu-divider" role="separator" />
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            className="account-menu-item"
            onClick={() => {
              void signOut().then(() => window.location.assign('/sign-in'))
            }}
          >
            <LogOut size={14} strokeWidth={1.7} aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

function AccountMenuThemeItem() {
  // SSR renders the light label; the boot script has already applied the
  // real theme, so the control catches up after mount without hydration
  // mismatch.
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => setTheme(readThemeAttr()), [])
  const next = theme === 'dark' ? 'light' : 'dark'
  const ThemeIcon = theme === 'dark' ? Sun : Moon

  return (
    <button
      role="menuitem"
      tabIndex={-1}
      type="button"
      className="account-menu-item"
      onClick={() => {
        writeThemeAttr(next)
        setTheme(next)
      }}
    >
      <ThemeIcon size={14} strokeWidth={1.7} aria-hidden="true" />
      {theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
  )
}
