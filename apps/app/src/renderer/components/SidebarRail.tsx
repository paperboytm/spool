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
export const DEFAULT_SIDEBAR_WIDTH = 240
export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH = 360

type Props = {
  collapsed: boolean
  children: ReactNode
  collapsedWidth?: 'none' | 'chrome'
  width?: number
  resizing?: boolean
}

/**
 * Animated sidebar-width ↔ 0 column that hosts the app's left navigation
 * sidebar. The wrapper clips its child via overflow-hidden so the
 * sidebar contents do not overflow during the fold.
 *
 * Used by both the top-level App shell and PageLayout (share editor).
 * Single source for the rail's timing keeps it in lock-step with
 * AppTopBar's bg sidebar segment, which paints the same surface
 * colour over the top of the chrome.
 */
export default function SidebarRail({
  collapsed,
  collapsedWidth = 'none',
  width = DEFAULT_SIDEBAR_WIDTH,
  resizing = false,
  children,
}: Props) {
  const collapsedPixels = collapsedWidth === 'chrome' ? 48 : 0
  return (
    <div
      className={`flex-none overflow-hidden ${resizing ? '' : 'transition-[width] duration-[280ms] ease-out'}`}
      style={{ width: collapsed ? collapsedPixels : width }}
      aria-hidden={collapsed && collapsedWidth === 'none'}
    >
      {children}
    </div>
  )
}
