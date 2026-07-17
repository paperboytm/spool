import {
  getSessionSourceColor,
  getSessionSourceColorDark,
  getSessionSourceShortLabel,
} from '../../shared/sessionSources.js'
import { useIsDark } from '../hooks/useIsDark.js'

export function SourceBadge({ source }: { source: string }) {
  const isDark = useIsDark()
  const color = isDark ? getSessionSourceColorDark(source) : getSessionSourceColor(source)
  return (
    <span
      data-testid="source-badge"
      data-source={source}
      className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded"
      style={{
        background: `color-mix(in srgb, ${color} ${isDark ? '16%' : '12%'}, transparent)`,
        color,
      }}
    >
      {getSessionSourceShortLabel(source)}
    </span>
  )
}
