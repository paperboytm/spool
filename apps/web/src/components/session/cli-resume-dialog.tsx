import { IconButton } from '@spool-lab/ui'
import { Check, Copy, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  resumeCommand: string
  onClose: () => void
}

export function CliResumeDialog({ open, resumeCommand, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow

    setCopied(false)
    document.body.style.overflow = 'hidden'
    dialogRef.current
      ?.querySelector<HTMLButtonElement>('[aria-label="Close CLI resume guide"]')
      ?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const copyCommand = async () => {
    await navigator.clipboard.writeText(resumeCommand)
    setCopied(true)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[rgba(20,20,16,0.48)] p-4 [[data-theme=dark]_&]:bg-[rgba(20,20,16,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cli-resume-title"
      aria-describedby="cli-resume-description"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-[520px] rounded-[10px] border border-[var(--border)] bg-[var(--card-2)] p-4 shadow-[var(--shadow-card)] sm:p-6 [[data-theme=dark]_&]:bg-[var(--card)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <SquareTerminal
              className="shrink-0 text-[var(--accent)]"
              size={20}
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <h2
              id="cli-resume-title"
              className="m-0 text-xl leading-8 font-semibold tracking-[-0.02em] text-[var(--text)]"
            >
              Resume with npx
            </h2>
          </div>
          <IconButton size="sm" type="button" aria-label="Close CLI resume guide" onClick={onClose}>
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
        </div>

        <p
          id="cli-resume-description"
          className="mt-3 mb-0 text-[13px] leading-5 text-[var(--muted)]"
        >
          Run one terminal command to continue this shared session locally. No global install is
          required.
        </p>

        <div className="mt-6 min-w-0">
          <p className="m-0 text-[13px] leading-5 text-[var(--text)]">
            Resume this session in its original agent.
          </p>
          <CommandRow
            command={resumeCommand}
            copied={copied}
            label="Session resume command"
            onCopy={() => void copyCommand()}
          />
        </div>

        <p className="mt-6 mb-0 border-t border-[var(--border)] pt-4 text-[11px] leading-4 text-[var(--muted)]">
          npx downloads the CLI when needed. Prefer a global install? Run{' '}
          <code className="font-mono text-[var(--text)]">npm install -g @spool-lab/cli</code>, then
          use <code className="font-mono text-[var(--text)]">spool resume …</code>.
        </p>
      </div>
    </div>
  )
}

function CommandRow({
  command,
  copied,
  label,
  onCopy,
}: {
  command: string
  copied: boolean
  label: string
  onCopy: () => void
}) {
  return (
    <div className="mt-3 flex h-8 min-w-0 gap-2" aria-label={label}>
      <code
        className="flex h-8 min-w-0 flex-1 items-center overflow-x-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-3 font-mono text-[11px] whitespace-nowrap text-[var(--text)]"
        title={command}
      >
        {command}
      </code>
      <IconButton
        size="md"
        type="button"
        title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        onClick={onCopy}
      >
        {copied ? (
          <Check size={14} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
        )}
      </IconButton>
    </div>
  )
}
