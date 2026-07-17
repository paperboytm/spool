type Props = {
  size?: number
  filled?: boolean
  className?: string
}

export default function PinIcon({ size = 13, filled = false, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.4 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M15.3 3.3l-4.8 4.8l-4.8 1.8l-1.8 1.8l8.4 8.4l1.8 -1.8l1.8 -4.8l4.8 -4.8" />
      <path d="M8.1 15.9l-5.4 5.4" />
      <path d="M14.7 2.7l6.6 6.6" />
    </svg>
  )
}
