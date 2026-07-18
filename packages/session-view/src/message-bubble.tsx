import { memo } from 'react'

import type { Range as FindRange } from './find-highlight-plugin.js'
import MarkdownContent from './markdown-content.js'
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
        <div className="rounded bg-neutral-100 px-3 py-2 text-xs text-neutral-500 italic dark:bg-neutral-800/60 dark:text-neutral-400">
          <MarkdownContent {...markdownProps} />
        </div>
      </div>
    )
  }

  if (isToolUseOnly) {
    return (
      <div className="flex items-center gap-2 px-6 py-0.5">
        {showAvatar ? (
          <div className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-neutral-700 text-[9px] font-bold text-white dark:bg-neutral-300 dark:text-neutral-900">
            A
          </div>
        ) : (
          <div className="h-5 w-5 flex-none" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-neutral-400">
          {message.toolNames.map((name) => (
            <span
              key={name}
              className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-500 dark:bg-neutral-800"
            >
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
          <div
            className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-[9px] font-bold ${
              isUser
                ? 'bg-accent dark:bg-accent-dark text-white dark:text-neutral-950'
                : 'bg-neutral-700 text-white dark:bg-neutral-300 dark:text-neutral-900'
            }`}
          >
            {isUser ? 'U' : 'A'}
          </div>
        ) : (
          <div className="mt-0.5 h-5 w-5 flex-none" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          {message.toolNames.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {message.toolNames.map((name) => (
                <span
                  key={name}
                  className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:bg-neutral-800"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
          <MarkdownContent {...markdownProps} />
          <p className="mt-1 text-[10px] text-neutral-400">{formatTime(message.timestamp)}</p>
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
    const locale =
      typeof document !== 'undefined' && document.documentElement.lang
        ? document.documentElement.lang
        : undefined
    return new Date(iso).toLocaleTimeString(locale)
  } catch {
    return ''
  }
}

export default memo(MessageBubble)
