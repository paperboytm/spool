import type { ReactNode } from 'react'

import AppTopBar from './AppTopBar.js'
import SidebarRail, { FOLD_EASE } from './SidebarRail.js'
import SidebarResizeHandle from './SidebarResizeHandle.js'

const RIGHT_PANEL_WIDTH = 280

type Props = {
  /** Left sidebar (Library / Shares / Projects rail). The caller
   *  owns this so each page can pass the same Sidebar instance with
   *  its app-wide handlers wired up. */
  sidebar: ReactNode
  sidebarCollapsed: boolean
  sidebarWidth: number
  sidebarResizing: boolean
  onSidebarWidthChange: (width: number) => void
  onSidebarResizeStart: () => void
  onSidebarResizeEnd: (width: number) => void
  onToggleSidebar: () => void
  trafficLightInset?: boolean
  /** Page chrome that gets portaled into the top bar's flex slot
   *  (back arrow, title, primary action buttons). Pass null on pages
   *  that don't need any. */
  topBar?: ReactNode
  /** Page-level right column (e.g. share editor's style picker).
   *  Sits below the AppTopBar so the bar spans the full window width
   *  and its primary actions stay reachable while the panel scrolls. */
  rightPanel?: ReactNode
  /** Controls the right column's animated width. */
  rightPanelOpen?: boolean
  /** Page body content — rendered in the central content area. */
  children: ReactNode
}

/**
 * Three-column layout shell. AppTopBar sits at the top and spans the
 * full window width (sidebar + content + rightPanel are all sibling
 * columns BELOW it). The bar paints a matching surface-coloured
 * segment over the right column so the top edge reads as one band.
 *
 * Slot prop pattern — callers pass JSX nodes for each slot instead of
 * portaling content via DOM ids. Keeps the layout's contract typed
 * and the render tree matching the DOM tree.
 */
export default function PageLayout({
  sidebar,
  sidebarCollapsed,
  sidebarWidth,
  sidebarResizing,
  onSidebarWidthChange,
  onSidebarResizeStart,
  onSidebarResizeEnd,
  onToggleSidebar,
  trafficLightInset = true,
  topBar,
  rightPanel,
  rightPanelOpen = false,
  children,
}: Props) {
  return (
    <div className="bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text relative flex h-screen flex-col">
      <AppTopBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        trafficLightInset={trafficLightInset}
        sidebarWidth={sidebarWidth}
        sidebarResizing={sidebarResizing}
      >
        {topBar}
      </AppTopBar>
      <div className="flex min-h-0 flex-1">
        <SidebarRail
          collapsed={sidebarCollapsed}
          collapsedWidth={!trafficLightInset ? 'chrome' : 'none'}
          width={sidebarWidth}
          resizing={sidebarResizing}
        >
          {sidebar}
        </SidebarRail>
        {!sidebarCollapsed && (
          <SidebarResizeHandle
            width={sidebarWidth}
            onWidthChange={onSidebarWidthChange}
            onResizeStart={onSidebarResizeStart}
            onResizeEnd={onSidebarResizeEnd}
          />
        )}
        <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
        {/* Outer animates width 0 ↔ 280; inner is hardcoded to
         *  RIGHT_PANEL_WIDTH so ControlPanel's ~1000-node subtree doesn't
         *  re-lay out each frame; the outer wrapper only clips it. */}
        <div
          className="flex-none overflow-hidden"
          style={{
            width: rightPanelOpen ? RIGHT_PANEL_WIDTH : 0,
            transition: `width 327ms ${FOLD_EASE}`,
          }}
          aria-hidden={!rightPanelOpen}
        >
          <div style={{ width: RIGHT_PANEL_WIDTH, height: '100%' }}>{rightPanel}</div>
        </div>
      </div>
    </div>
  )
}
