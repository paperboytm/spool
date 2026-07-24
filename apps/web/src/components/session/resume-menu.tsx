import { Button, Tabs } from '@spool-lab/ui'
import { Check, ChevronDown, Copy, SquareTerminal } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import {
  copyCommandText,
  resumeCommandOptions,
  type CopyCommandState,
  type ResumeCommandOption,
} from '../../lib/cli-command'

import '../../styles/resume-menu.css'

/**
 * GitHub-clone-style Resume control: one primary button, a popover that
 * lets the reader pick the command matching their machine (spool already
 * installed vs first-time install) instead of forcing the curl bootstrap
 * on everyone.
 */
export function ResumeMenu({ sid, providerLabel }: { sid: string; providerLabel: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const id = useId().replace(/:/g, '')
  const panelId = `resume-menu-panel-${id}`

  useEffect(() => {
    if (!open) return
    dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()

    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (root && event.target && !root.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      rootRef.current?.querySelector<HTMLButtonElement>('[data-resume-trigger]')?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div
      className="relative inline-flex min-w-0"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <Button
        type="button"
        className="resume-menu-trigger"
        data-resume-trigger
        variant="accent"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <SquareTerminal size={14} strokeWidth={1.7} aria-hidden="true" />
        Resume in {providerLabel}
        <ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" />
      </Button>
      {open ? (
        <div
          ref={dialogRef}
          id={panelId}
          role="dialog"
          aria-label="Resume this Session locally"
          className="absolute top-[calc(100%+8px)] left-0 z-40 w-[min(480px,calc(100vw-32px))] rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-3 shadow-[var(--sp-shadow-popover)]"
        >
          <ResumeOptionsPanel sid={sid} />
        </div>
      ) : null}
    </div>
  )
}

/** Panel body, exported separately so tests can render it open. */
export function ResumeOptionsPanel({ sid }: { sid: string }) {
  const options = resumeCommandOptions(sid)
  const [selectedId, setSelectedId] = useState<ResumeCommandOption['id']>('installed')
  const [copyState, setCopyState] = useState<CopyCommandState>('idle')
  const selected = options.find((option) => option.id === selectedId) ?? options[0]!
  const id = useId().replace(/:/g, '')
  const tabPrefix = `resume-command-tab-${id}`
  const tabPanelId = `resume-command-panel-${id}`

  const copy = async () => {
    const state = await copyCommandText(selected.command)
    setCopyState(state)
    window.setTimeout(() => setCopyState('idle'), state === 'copied' ? 1400 : 2600)
  }

  const copied = copyState === 'copied'
  const copyFailed = copyState === 'failed'

  return (
    <div className="min-w-0">
      <Tabs
        className="resume-command-tabs"
        aria-label="Resume command options"
        value={selected.id}
        items={options.map((option) => ({
          value: option.id,
          label: option.label,
          id: `${tabPrefix}-${option.id}`,
          ariaControls: tabPanelId,
        }))}
        onValueChange={(value) => {
          setSelectedId(value as ResumeCommandOption['id'])
          setCopyState('idle')
        }}
      />

      <div
        id={tabPanelId}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`${tabPrefix}-${selected.id}`}
        className="resume-command-panel"
      >
        <p className="mt-2 mb-0 text-[11px] leading-4 text-[var(--muted)]">
          {selected.description}
        </p>

        <div className="mt-2 flex min-w-0 gap-2" aria-label="Resume command">
          <code
            className="resume-command-code flex h-8 min-w-0 flex-1 items-center overflow-x-auto rounded-md border border-[var(--border-strong)] bg-[var(--card)] px-3 font-mono text-[12px] whitespace-nowrap text-[var(--text)]"
            title={selected.command}
          >
            {selected.command}
          </code>
          <Button
            type="button"
            className="resume-command-copy h-8 shrink-0"
            variant="accent"
            title={
              copied ? 'Copied' : copyFailed ? 'Copy failed; try again' : 'Copy resume command'
            }
            aria-label={
              copied
                ? 'Resume command copied'
                : copyFailed
                  ? 'Copy failed; try resume command again'
                  : 'Copy resume command'
            }
            onClick={() => void copy()}
          >
            {copied ? (
              <Check size={14} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
            )}
            <span className="sr-only" aria-live="polite">
              {copied ? 'Copied' : copyFailed ? 'Copy failed; select the command manually' : ''}
            </span>
            {copied ? 'Copied' : copyFailed ? 'Try again' : 'Copy'}
          </Button>
        </div>

        <p className="mt-2 mb-0 text-[11px] leading-4 text-[var(--muted)]">
          Resume creates a new local Session. This published source stays unchanged.
          {copyFailed && (
            <span className="ml-2 text-[var(--error)]">
              Copy failed — select the command manually.
            </span>
          )}
        </p>
      </div>
    </div>
  )
}
