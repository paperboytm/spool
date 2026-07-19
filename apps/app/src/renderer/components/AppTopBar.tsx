import { IconButton } from '@spool-lab/ui'
import { PanelLeft } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  trafficLightInset?: boolean
  /** Page-level chrome (page title, primary action). Rendered into a
   *  flex slot to the right of the sidebar fold toggle. */
  children?: ReactNode
}

/**
 * Slim app-level chrome that sits flush with the macOS traffic lights
 * (the BrowserWindow uses titleBarStyle 'hiddenInset'). The bar's
 * background splits into sidebar / content halves that align with the
 * boundary below it, so the eye reads "left column + right column"
 * running top-to-bottom.
 */
export default function AppTopBar({
  sidebarCollapsed,
  onToggleSidebar,
  trafficLightInset = true,
  children,
}: Props) {
  const { t } = useTranslation()
  const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties
  const sidebarTitle = sidebarCollapsed
    ? `${t('sidebar.expand')} (⌘B)`
    : `${t('sidebar.collapse')} (⌘B)`

  if (!trafficLightInset && !children) {
    return null
  }

  return (
    <div
      data-testid="app-top-bar"
      className="relative min-h-9 flex-none select-none"
      style={dragStyle}
    >
      {/* Background: animated sidebar split + content bg flooding the
          rest of the bar. macOS collapses the sidebar segment to zero
          because its traffic-light gutter stays in the top bar; Linux
          keeps a narrow sidebar chrome segment so page chrome aligns
          with the content pane below. */}
      <div className="pointer-events-none absolute inset-0 flex" aria-hidden="true">
        <div
          className={[
            'flex-none transition-[width] duration-[280ms] ease-out bg-warm-surface dark:bg-dark-surface',
            sidebarCollapsed ? (trafficLightInset ? 'w-0' : 'w-12') : 'w-60',
          ].join(' ')}
        />
        <div className="bg-warm-bg dark:bg-dark-bg flex-1" />
      </div>

      {/* Foreground: macOS keeps the fold button in the hiddenInset title
          bar next to the traffic lights. Other platforms render the
          fold row inside the sidebar itself, so this bar only reserves
          the sidebar width before page chrome. */}
      <div className="relative flex min-h-9 items-stretch">
        {trafficLightInset ? (
          <>
            <div className="w-[78px] flex-none" aria-hidden="true" />
            <div className="flex flex-none items-center">
              <SidebarToggleButton
                title={sidebarTitle}
                ariaLabel={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
                pressed={sidebarCollapsed}
                onToggle={onToggleSidebar}
                noDragStyle={noDragStyle}
              />
            </div>
            <div
              className={[
                'flex-none transition-[width] duration-[280ms] ease-out',
                sidebarCollapsed ? 'w-0' : 'w-[134px]',
              ].join(' ')}
              aria-hidden="true"
            />
          </>
        ) : (
          <div
            className={[
              'flex-none transition-[width] duration-[280ms] ease-out',
              sidebarCollapsed ? 'w-12' : 'w-60',
            ].join(' ')}
            aria-hidden="true"
          />
        )}
        {/* Slot inherits `drag` from the bar so whitespace around page
            chrome remains a drag handle. Interactive elements injected
            into this slot must opt out individually with
            `WebkitAppRegion: 'no-drag'`. */}
        <div data-testid="app-top-bar-slot" className="flex min-w-0 flex-1 items-stretch">
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarToggleButton({
  title,
  ariaLabel,
  pressed,
  onToggle,
  noDragStyle,
}: {
  title: string
  ariaLabel: string
  pressed: boolean
  onToggle: () => void
  noDragStyle: CSSProperties
}) {
  return (
    <IconButton
      aria-label={ariaLabel}
      data-testid="sidebar-toggle"
      onClick={onToggle}
      title={title}
      aria-pressed={pressed}
      style={noDragStyle}
    >
      <PanelLeft size={13} strokeWidth={1.75} />
    </IconButton>
  )
}
