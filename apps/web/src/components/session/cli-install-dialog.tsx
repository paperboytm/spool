import { Check, Copy, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export const CLI_INSTALL_COMMAND = 'npm install -g @spool-lab/cli'

interface Props {
  open: boolean
  resumeCommand: string
  onClose: () => void
}

type CopiedCommand = 'install' | 'resume' | null

export function CliInstallDialog({ open, resumeCommand, onClose }: Props) {
  const [copiedCommand, setCopiedCommand] = useState<CopiedCommand>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow

    setCopiedCommand(null)
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

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

  const copyCommand = async (kind: Exclude<CopiedCommand, null>, command: string) => {
    await navigator.clipboard.writeText(command)
    setCopiedCommand(kind)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[rgba(20,20,16,0.48)] p-4 [[data-theme=dark]_&]:bg-[rgba(20,20,16,0.72)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cli-install-title"
      aria-describedby="cli-install-description"
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
              id="cli-install-title"
              className="m-0 text-xl leading-8 font-semibold tracking-[-0.02em] text-[var(--text)]"
            >
              Install the Spool CLI
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="m-0 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--muted)] transition-colors duration-[80ms] hover:bg-[var(--card-2)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            aria-label="Close CLI installation guide"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <p
          id="cli-install-description"
          className="mt-3 mb-0 text-[13px] leading-5 text-[var(--muted)]"
        >
          Two terminal commands are all you need to continue this shared session locally.
        </p>

        <ol className="mt-6 mb-0 flex list-none flex-col gap-6 p-0">
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
            <StepNumber>1</StepNumber>
            <div className="min-w-0">
              <p className="m-0 text-[13px] leading-5 text-[var(--text)]">
                Install the CLI globally with npm.
              </p>
              <CommandRow
                command={CLI_INSTALL_COMMAND}
                copied={copiedCommand === 'install'}
                label="CLI install command"
                onCopy={() => void copyCommand('install', CLI_INSTALL_COMMAND)}
              />
            </div>
          </li>

          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
            <StepNumber>2</StepNumber>
            <div className="min-w-0">
              <p className="m-0 text-[13px] leading-5 text-[var(--text)]">
                Resume this session in its original agent.
              </p>
              <CommandRow
                command={resumeCommand}
                copied={copiedCommand === 'resume'}
                label="Session resume command"
                onCopy={() => void copyCommand('resume', resumeCommand)}
              />
            </div>
          </li>
        </ol>

        <p className="mt-6 mb-0 border-t border-[var(--border)] pt-4 text-[11px] leading-4 text-[var(--muted)]">
          Spool downloads the shared session locally, then opens it in Claude Code or Codex CLI.
        </p>
      </div>
    </div>
  )
}

function StepNumber({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border-strong)] bg-[var(--card-2)] font-mono text-[11px] font-medium text-[var(--muted)] tabular-nums"
      aria-hidden="true"
    >
      {children}
    </span>
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
    <div className="mt-3 flex h-8 min-w-0" aria-label={label}>
      <code
        className="flex h-8 min-w-0 flex-1 items-center overflow-x-auto rounded-l-md border border-r-0 border-[var(--border-strong)] bg-[var(--bg)] px-3 font-mono text-[11px] whitespace-nowrap text-[var(--text)]"
        title={command}
      >
        {command}
      </code>
      <button
        type="button"
        className="m-0 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-r-md border border-[var(--border-strong)] bg-[var(--bg)] p-0 text-[var(--muted)] transition-colors duration-[80ms] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        onClick={onCopy}
      >
        {copied ? (
          <Check size={14} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
