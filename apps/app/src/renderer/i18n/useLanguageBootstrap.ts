import { useEffect } from 'react'
import { applyLanguage, resolveLocale, type LanguagePreference, type SupportedLocale } from './index.js'

/**
 * Resolves the effective UI language on mount and whenever the user changes
 * their preference. Reads `AgentsConfig.language` (a `LanguagePreference` —
 * `'system'` or one of the supported locales) from main, falls back to the
 * OS locale exposed by `spool:get-system-locale`, and applies it to i18next.
 *
 * Pass `undefined` while the preference is still loading — the hook will
 * no-op so the locale picked up from the localStorage cache during i18n init
 * stays in place. Applying with `'system'` before the config has loaded
 * would otherwise momentarily flip the UI to the OS locale, causing a flash
 * (e.g. zh-CN → en → zh-CN for a Chinese user on an English macOS).
 */
export function useLanguageBootstrap(preference: LanguagePreference | undefined): void {
  useEffect(() => {
    if (preference === undefined) return
    let cancelled = false
    const apply = async () => {
      let systemLocale: SupportedLocale = 'en'
      try {
        const reported = await window.spool?.getSystemLocale?.()
        if (reported) systemLocale = reported
      } catch (err) {
        console.error('[i18n] failed to read system locale', err)
      }
      if (cancelled) return
      applyLanguage(resolveLocale(preference, systemLocale))
    }
    void apply()
    return () => { cancelled = true }
  }, [preference])
}
