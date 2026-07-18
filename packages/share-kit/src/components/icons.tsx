// Icons used across Spool. Re-exports from Lucide for standard glyphs,
// plus a custom Bobbin spinner — the textile-flavored loading indicator
// that replaces a generic spinner. Two dots in orbit, not a wedge.

import { Link, ArrowRight, Sparkles, Shield, AlertCircle, Copy } from 'lucide-react'

export {
  Link as IconLink,
  ArrowRight as IconArrow,
  Sparkles as IconSparkle,
  Shield as IconShield,
  AlertCircle as IconAlert,
  Copy as IconCopy,
}

interface BobbinProps {
  size?: number
  color?: string
}

export function Bobbin({ size = 14, color = 'currentColor' }: BobbinProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      style={{ animation: 'spool-spin 900ms linear infinite' }}
    >
      <circle cx="7" cy="2" r="1.5" fill={color} />
      <circle cx="7" cy="12" r="1.5" fill={color} opacity="0.35" />
    </svg>
  )
}
