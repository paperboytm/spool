import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import de from './locales/de.json'
import fr from './locales/fr.json'

export type SupportedLocale = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'de' | 'fr'
export type LanguagePreference = 'system' | SupportedLocale

export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr']

const STORAGE_KEY = 'spool:lang-cache'

/**
 * Last-resort cache so the very first paint after a locale change (or app
 * restart) doesn't flash English while the config IPC is in flight. Synced
 * to localStorage on every `applyLanguage` call.
 */
function readCachedLocale(): SupportedLocale | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'en' || v === 'zh-CN' || v === 'zh-TW' || v === 'ja' || v === 'ko' || v === 'de' || v === 'fr') return v
  } catch { /* localStorage disabled — ignore */ }
  return null
}

function writeCachedLocale(locale: SupportedLocale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch { /* ignore */ }
}

// Initial language: cached value if available, else en. The renderer will
// call `applyLanguage` once it resolves the user's preference.
const initialLocale: SupportedLocale = readCachedLocale() ?? 'en'

// Set <html lang> synchronously here so anything that reads it on first
// paint (Intl.DateTimeFormat in formatDate.ts, CSS `:lang(...)`, ATs) sees
// the right locale immediately. Otherwise dates render under the browser
// default and only switch to the cached locale once `applyLanguage` runs
// for the first time, which is visible as a flash + a beachball on CJK
// locales where V8 has to instantiate ICU data on the main thread.
if (typeof document !== 'undefined' && document.documentElement.lang !== initialLocale) {
  document.documentElement.lang = initialLocale
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      'zh-TW': { translation: zhTW },
      ja: { translation: ja },
      ko: { translation: ko },
      de: { translation: de },
      fr: { translation: fr },
    },
    lng: initialLocale,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  })
  .catch((err) => {
    console.error('[i18n] init failed', err)
  })

/**
 * Resolves a `LanguagePreference` (which may be `'system'`) plus a system
 * locale into a concrete supported locale.
 */
export function resolveLocale(
  pref: LanguagePreference | undefined,
  systemLocale: SupportedLocale,
): SupportedLocale {
  if (!pref || pref === 'system') return systemLocale
  return pref
}

/**
 * Apply a locale to the i18n instance and reflect it on <html lang> for
 * accessibility + locale-aware CSS (e.g. CJK-aware font stacks). Cheap to
 * call repeatedly — i18next no-ops when the language is unchanged.
 */
export function applyLanguage(locale: SupportedLocale): void {
  if (i18n.language !== locale) {
    void i18n.changeLanguage(locale)
  }
  if (typeof document !== 'undefined' && document.documentElement.lang !== locale) {
    document.documentElement.lang = locale
  }
  writeCachedLocale(locale)
}

export default i18n
