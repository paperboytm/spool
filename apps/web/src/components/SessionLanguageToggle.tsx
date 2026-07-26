import { Languages } from 'lucide-react'

import { setSessionLanguage, useSessionLanguage } from '../lib/language'

import '../styles/session-language.css'

export function SessionLanguageToggle({
  className,
  showLabel = false,
}: {
  className?: string
  showLabel?: boolean
}) {
  const language = useSessionLanguage()
  const classes = [
    'session-language-toggle',
    showLabel ? 'session-language-toggle--expanded' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} role="group" aria-label="Session language">
      {showLabel ? (
        <span className="session-language-toggle__label">
          <Languages size={15} strokeWidth={1.7} aria-hidden="true" />
          <span>Session language</span>
        </span>
      ) : null}
      <button
        className="session-language-toggle__option"
        type="button"
        aria-label="Show Sessions in English"
        aria-pressed={language === 'en'}
        onClick={() => setSessionLanguage('en')}
      >
        EN
      </button>
      <button
        className="session-language-toggle__option"
        type="button"
        lang="zh-CN"
        aria-label="用中文显示 Session"
        aria-pressed={language === 'zh'}
        onClick={() => setSessionLanguage('zh')}
      >
        中文
      </button>
    </div>
  )
}

export function SessionLanguageToolbar({ className }: { className?: string }) {
  return (
    <div
      className={['session-language-toolbar', className].filter(Boolean).join(' ')}
      aria-label="Session display preferences"
    >
      <span className="session-language-toolbar__label">
        <Languages size={15} strokeWidth={1.7} aria-hidden="true" />
        <span>Session language</span>
      </span>
      <SessionLanguageToggle />
    </div>
  )
}
