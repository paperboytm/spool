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
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div
        className="bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted mb-5 flex h-14 w-14 items-center justify-center rounded-full"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="text-warm-text dark:text-dark-text mb-2 text-xl font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      <p className="text-warm-muted dark:text-dark-muted max-w-[360px] text-sm leading-relaxed">
        {hint}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function SmallEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-warm-muted dark:text-dark-muted flex items-center justify-center px-6 py-16 text-center text-sm">
      {children}
    </div>
  )
}
