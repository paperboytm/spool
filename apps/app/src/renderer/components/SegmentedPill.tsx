import type { ReactNode } from 'react'

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  hideLabel?: boolean
  testId?: string
  title?: string
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Array<SegmentedOption<T>>
  compact?: boolean
  ariaLabel?: string
}

export default function SegmentedPill<T extends string>({
  value,
  onChange,
  options,
  compact = false,
  ariaLabel,
}: Props<T>) {
  return (
    <div
      role="tablist"
      className="flex bg-warm-surface dark:bg-dark-surface rounded-full p-[2px]"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={option.testId}
            title={option.title ?? option.label}
            aria-label={option.title ?? option.label}
            onClick={() => onChange(option.value)}
            className={[
              'inline-flex items-center justify-center gap-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-0',
              compact ? 'h-5 px-2' : 'h-7 px-2.5',
              active
                ? 'bg-warm-bg dark:bg-dark-bg text-accent dark:text-accent-dark'
                : 'text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text',
            ].join(' ')}
          >
            {option.icon}
            {!option.hideLabel && <span>{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
