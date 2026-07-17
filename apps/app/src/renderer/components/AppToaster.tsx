import { CircleCheck, CircleAlert, TriangleAlert, Info } from 'lucide-react'
import { Toaster } from 'sonner'

/**
 * App-wide toast surface. Wraps sonner's <Toaster /> with DESIGN.md tokens:
 * elevated warm card, type-specific tints + Lucide icons so status reads
 * at a glance, amber accent only on the action button.
 */
export default function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      theme="system"
      duration={4000}
      visibleToasts={3}
      gap={10}
      offset={20}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: [
            'group/toast pointer-events-auto',
            'flex items-center gap-3',
            'min-w-[260px] max-w-[380px] w-max px-3.5 py-2.5',
            'rounded-[10px]',
            // Default (neutral / non-typed) — elevated white card.
            'bg-white dark:bg-[#2A2A24]',
            'ring-1 ring-warm-border/70 dark:ring-white/[0.06]',
            'shadow-[0_1px_2px_rgba(20,20,16,0.04),0_8px_28px_rgba(20,20,16,0.10)]',
            'dark:shadow-[0_2px_8px_rgba(0,0,0,0.35),0_16px_40px_rgba(0,0,0,0.45)]',
            'font-sans text-warm-text dark:text-dark-text',
          ].join(' '),
          // Per-type tints: light wash + tinted ring. Subtle enough to
          // sit alongside warm palette, strong enough to read as status.
          success: [
            'bg-[#F1F8F1] dark:bg-[#1F2A1F]',
            'ring-[color:var(--color-status-success)]/30 dark:ring-[color:var(--color-status-success-dark)]/30',
          ].join(' '),
          error: [
            'bg-[#FDF1EE] dark:bg-[#2E1F1B]',
            'ring-[color:var(--color-status-error)]/35 dark:ring-[color:var(--color-status-error-dark)]/35',
          ].join(' '),
          warning: [
            'bg-[#FBF4E5] dark:bg-[#2E261B]',
            'ring-[color:var(--color-status-warning)]/35 dark:ring-[color:var(--color-status-warning-dark)]/35',
          ].join(' '),
          info: [
            'bg-warm-surface dark:bg-dark-surface2',
            'ring-warm-border dark:ring-dark-border',
          ].join(' '),
          icon: 'flex-none flex items-center justify-center self-start mt-[2px]',
          content: 'flex flex-col gap-0.5 min-w-0 flex-1',
          title: 'text-[13px] font-normal leading-snug tracking-[-0.005em] truncate',
          description:
            'text-[12px] leading-snug text-warm-muted dark:text-dark-muted line-clamp-2 break-all',
          actionButton: [
            'shrink-0 self-center',
            'px-2.5 py-1 rounded-md',
            'text-[12px] font-medium',
            'text-accent dark:text-accent-dark',
            'hover:bg-accent-bg dark:hover:bg-accent-bg-dark',
            'transition-colors',
          ].join(' '),
          cancelButton: [
            'shrink-0 self-center',
            'px-2.5 py-1 rounded-md',
            'text-[12px]',
            'text-warm-muted dark:text-dark-muted',
            'hover:bg-warm-surface dark:hover:bg-dark-surface',
            'transition-colors',
          ].join(' '),
        },
      }}
      icons={{
        success: (
          <CircleCheck
            size={16}
            strokeWidth={2}
            className="text-[color:var(--color-status-success)] dark:text-[color:var(--color-status-success-dark)]"
          />
        ),
        error: (
          <CircleAlert
            size={16}
            strokeWidth={2}
            className="text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]"
          />
        ),
        warning: (
          <TriangleAlert
            size={16}
            strokeWidth={2}
            className="text-[color:var(--color-status-warning)] dark:text-[color:var(--color-status-warning-dark)]"
          />
        ),
        info: (
          <Info
            size={16}
            strokeWidth={2}
            className="text-warm-muted dark:text-dark-muted"
          />
        ),
      }}
    />
  )
}
