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
        <div className="rounded-badge bg-surface text-button text-muted px-3 py-2 italic">
          <MarkdownContent {...markdownProps} />
        </div>
      </div>
    )
  }

  if (isToolUseOnly) {
    return (
      <div className="py-half flex items-center gap-2 px-6">
        {showAvatar ? (
          <div className="bg-muted text-background rounded-pill text-label flex h-5 w-5 flex-none items-center justify-center font-bold">
            A
          </div>
        ) : (
          <div className="h-5 w-5 flex-none" aria-hidden />
        )}
        <div className="text-faint text-label flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
          {message.toolNames.map((name) => (
            <span
              key={name}
              className="rounded-badge bg-surface py-half text-muted px-1.5 font-mono"
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
            className={`mt-half rounded-pill text-label flex h-5 w-5 flex-none items-center justify-center font-bold ${
              isUser ? 'bg-accent-fill text-on-accent' : 'bg-muted text-background'
            }`}
          >
            {isUser ? 'U' : 'A'}
          </div>
        ) : (
          <div className="mt-half h-5 w-5 flex-none" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          {message.toolNames.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {message.toolNames.map((name) => (
                <span
                  key={name}
                  className="rounded-badge bg-surface py-half text-label text-muted px-1.5 font-mono"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
          <MarkdownContent {...markdownProps} />
          <p className="text-label text-faint mt-1">{formatTime(message.timestamp)}</p>
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
