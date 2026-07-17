import { memo } from 'react'
import MarkdownContent from './markdown-content.js'
import type { Range as FindRange } from './find-highlight-plugin.js'
import type { ConversationMessage } from './types.js'

export type { FindRange }

interface Props {
  message: ConversationMessage
  isDark: boolean
  showAvatar?: boolean
  findRanges?: ReadonlyArray<FindRange>
  matchIndexOffset?: number
  activeMatchIndex?: number
  onActiveMatchRef?: ((node: HTMLElement | null) => void) | undefined
}

function MessageBubble({
  message,
  isDark,
  showAvatar = true,
  findRanges = [],
  matchIndexOffset = 0,
  activeMatchIndex = -1,
  onActiveMatchRef,
}: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isToolUseOnly = message.toolNames.length > 0 && !message.contentText
  const contentText = message.contentText || (isSystem ? '(summary)' : '')

  const markdownProps = {
    text: contentText,
    isDark,
    findRanges,
    matchIndexOffset,
    activeMatchIndex,
    ...(onActiveMatchRef ? { onActiveMatchRef } : {}),
  }

  if (isSystem) {
    return (
      <div className="px-6 py-2">
        <div className="bg-neutral-100 dark:bg-neutral-800/60 rounded px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 italic">
          <MarkdownContent {...markdownProps} />
        </div>
      </div>
    )
  }

  if (isToolUseOnly) {
    return (
      <div className="px-6 py-0.5 flex items-center gap-2">
        {showAvatar ? (
          <div className="flex-none w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-900">
            A
          </div>
        ) : (
          <div className="flex-none w-5 h-5" aria-hidden />
        )}
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-neutral-400">
          {message.toolNames.map((name) => (
            <span key={name} className="font-mono bg-neutral-100 dark:bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded">
              {name}
            </span>
          ))}
          <span className="font-mono">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-2">
      <div className="flex items-start gap-2">
        {showAvatar ? (
          <div className={`flex-none w-5 h-5 rounded-full mt-0.5 flex items-center justify-center text-[9px] font-bold ${
            isUser
              ? 'bg-accent text-white dark:bg-accent-dark dark:text-neutral-950'
              : 'bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-900'
          }`}>
            {isUser ? 'U' : 'A'}
          </div>
        ) : (
          <div className="flex-none w-5 h-5 mt-0.5" aria-hidden />
        )}
        <div className="flex-1 min-w-0">
          {message.toolNames.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {message.toolNames.map((name) => (
                <span key={name} className="text-[10px] font-mono bg-neutral-100 dark:bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded">
                  {name}
                </span>
              ))}
            </div>
          )}
          <MarkdownContent {...markdownProps} />
          <p className="text-[10px] text-neutral-400 mt-1">{formatTime(message.timestamp)}</p>
        </div>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    // Respect the host page's UI language (set on <html lang>) instead of
    // inheriting the OS region setting — otherwise an English OS produces
    // "10:35:02 PM" even when the surrounding UI is in Chinese.
    const locale = typeof document !== 'undefined' && document.documentElement.lang
      ? document.documentElement.lang
      : undefined
    return new Date(iso).toLocaleTimeString(locale)
  } catch { return '' }
}

export default memo(MessageBubble)
