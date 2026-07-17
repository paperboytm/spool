import type { ReactNode } from 'react'

// Fold-motion curve used by every sidebar / panel collapse in the app
// chrome. Exposed as a constant so consumers that need an inline
// `transition` (e.g. PageLayout's right panel with a non-standard
// duration) can match this rail's Tailwind ease-out exactly. Tailwind's
// `ease-out` utility resolves to this same cubic-bezier; the CSS
// `ease-out` keyword resolves to (0,0,0.58,1), a DIFFERENT, gentler
// curve. Mixing the two made the topbar bg segment land ahead of the
// rail below it, so all fold motion is pinned to this token.
export const FOLD_EASE = 'cubic-bezier(0, 0, 0.2, 1)'
export const FOLD_DURATION_MS = 280

type Props = {
  collapsed: boolean
  children: ReactNode
  collapsedWidth?: 'none' | 'chrome'
}

/**
 * Animated 240px ↔ 0 column that hosts the app's left navigation
 * sidebar. The wrapper clips its child via overflow-hidden so the
 * sidebar contents (Sidebar root is `w-60 flex-none`) never reflow
 * during the fold — only the wrapper's width transitions.
 *
 * Used by both the top-level App shell and PageLayout (share editor).
 * Single source for the rail's timing keeps it in lock-step with
 * AppTopBar's bg sidebar segment, which paints the same surface
 * colour over the top of the chrome.
 */
export default function SidebarRail({ collapsed, collapsedWidth = 'none', children }: Props) {
  const collapsedClass = collapsedWidth === 'chrome' ? 'w-12' : 'w-0'
  return (
    <div
      className={[
        'flex-none overflow-hidden transition-[width] duration-[280ms] ease-out',
        collapsed ? collapsedClass : 'w-60',
      ].join(' ')}
      aria-hidden={collapsed && collapsedWidth === 'none'}
    >
      {children}
    </div>
  )
}
