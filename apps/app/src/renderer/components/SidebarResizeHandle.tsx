import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from './SidebarRail.js'

type Props = {
  width: number
  onWidthChange: (width: number) => void
  onResizeStart: () => void
  onResizeEnd: (width: number) => void
}

type DragState = {
  pointerId: number
  startX: number
  startWidth: number
  currentWidth: number
}

export function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

export default function SidebarResizeHandle({
  width,
  onWidthChange,
  onResizeStart,
  onResizeEnd,
}: Props) {
  const { t } = useTranslation()
  const dragRef = useRef<DragState | null>(null)

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      currentWidth: width,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    onResizeStart()
    event.preventDefault()
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.currentWidth = clampSidebarWidth(drag.startWidth + event.clientX - drag.startX)
    onWidthChange(drag.currentWidth)
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onResizeEnd(drag.currentWidth)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null
    const step = event.shiftKey ? 24 : 8
    if (event.key === 'ArrowLeft') next = width - step
    else if (event.key === 'ArrowRight') next = width + step
    else if (event.key === 'Home') next = MIN_SIDEBAR_WIDTH
    else if (event.key === 'End') next = MAX_SIDEBAR_WIDTH
    if (next === null) return
    event.preventDefault()
    const clamped = clampSidebarWidth(next)
    onWidthChange(clamped)
    onResizeEnd(clamped)
  }

  function resetWidth() {
    onWidthChange(DEFAULT_SIDEBAR_WIDTH)
    onResizeEnd(DEFAULT_SIDEBAR_WIDTH)
  }

  return (
    <div className="relative z-20 w-0 flex-none">
      <div
        role="separator"
        aria-label={t('sidebar.resize')}
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        data-testid="sidebar-resize-handle"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={handleKeyDown}
        onDoubleClick={resetWidth}
        title={t('sidebar.resize')}
        className="group absolute inset-y-0 -left-1 w-2 cursor-col-resize touch-none focus-visible:outline-none"
      >
        <span className="bg-warm-border dark:bg-dark-border group-hover:bg-warm-accent dark:group-hover:bg-dark-accent group-focus-visible:bg-warm-accent dark:group-focus-visible:bg-dark-accent absolute inset-y-0 left-[3px] w-px transition-colors duration-75" />
      </div>
    </div>
  )
}
