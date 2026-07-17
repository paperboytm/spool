import type { ReactNode } from 'react'

export function FeaturedEmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode
  title: string
  hint: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mb-5 bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="text-xl font-semibold tracking-[-0.01em] text-warm-text dark:text-dark-text mb-2">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-warm-muted dark:text-dark-muted max-w-[360px]">
        {hint}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function SmallEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center px-6 py-16 text-sm text-warm-muted dark:text-dark-muted text-center">
      {children}
    </div>
  )
}
