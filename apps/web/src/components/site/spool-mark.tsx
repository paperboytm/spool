/* The Spool mark: a thread winding diagonally down a spool, seen from
 * slightly above. The solid cap is the spool's flange — wider than the
 * wound thread below it — and the loose thread end exits bottom-right.
 * Single-color (currentColor) so it inherits its context. */

export function SpoolMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden
    >
      <ellipse cx="16" cy="7.2" rx="12.2" ry="4.1" fill="currentColor" stroke="none" />
      <g fill="none" strokeWidth={1.9}>
        <path d="M7 12.2 C13 15.8 19.5 15.4 25 14.2" />
        <path d="M7 16.4 C13 20 19.5 19.6 25 18.4" />
        <path d="M7 20.6 C13 24.2 19.5 23.8 25 22.6" />
        <path d="M25 22.6 C26.8 24.4 28.4 25.6 30.4 26.2" strokeWidth={1.7} />
      </g>
    </svg>
  )
}
