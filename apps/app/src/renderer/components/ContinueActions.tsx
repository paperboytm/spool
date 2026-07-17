import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Eye, SquareTerminal, SquarePen, Copy, Loader2 } from 'lucide-react'
import type { FragmentResult } from '@spool-lab/core'
import Menu from './Menu.js'
import { getSessionResumeCommand } from '../../shared/resumeCommand.js'

type Props = {
  result: FragmentResult
  onOpenSession: (uuid: string, messageId?: number) => void
  onCopySessionId: (source: FragmentResult['source']) => void
  onShare?: () => void
}

const ICON_SIZE = 14
const ICON_STROKE = 1.6

export default function ContinueActions({ result, onOpenSession, onCopySessionId, onShare }: Props) {
  const { t } = useTranslation()
  const [copiedId, setCopiedId] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState(false)
  const [resuming, setResuming] = useState(false)
  const resumeCommand = getSessionResumeCommand(result.source, result.sessionUuid, result.cwd)

  async function handleCopyId() {
    await navigator.clipboard.writeText(result.sessionUuid)
    onCopySessionId(result.source)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 1500)
  }

  async function handleResume() {
    setResuming(true)
    await window.spool.resumeCLI(result.sessionUuid, result.source, result.cwd)
    setTimeout(() => setResuming(false), 1000)
  }

  async function handleCopyCommand() {
    if (!resumeCommand) return
    await navigator.clipboard.writeText(resumeCommand)
    setCopiedCommand(true)
    setTimeout(() => setCopiedCommand(false), 1500)
  }

  const menuItems = [
    {
      label: t('common.viewSession'),
      icon: <Eye size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />,
      onSelect: () => onOpenSession(result.sessionUuid, result.messageId),
    },
    ...(onShare ? [{
      label: t('shareEditor.openNew'),
      icon: <SquarePen size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />,
      onSelect: onShare,
    }] : []),
    ...(resumeCommand ? [{
      label: resuming ? t('common.openingTerminal') : t('session.resume_inTerminal'),
      icon: resuming
        ? <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin" aria-hidden />
        : <SquareTerminal size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />,
      onSelect: () => { void handleResume() },
      disabled: resuming,
    }] : []),
    ...(resumeCommand ? [{
      label: copiedCommand ? t('common.copiedResumeCommand') : t('common.copyResumeCommand'),
      icon: <Copy size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />,
      onSelect: () => { void handleCopyCommand() },
    }] : []),
    {
      label: copiedId ? t('toast.copiedSessionId') : t('sidebar.copySessionId'),
      icon: <Copy size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />,
      onSelect: () => { void handleCopyId() },
    },
  ]

  return (
    <Menu
      align="right"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-label={t('common.moreActions')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            toggle()
          }}
          className="flex-none self-center inline-flex items-center justify-center w-5 h-5 rounded text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors"
        >
          <MoreHorizontal size={13} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      )}
      items={menuItems}
    />
  )
}
