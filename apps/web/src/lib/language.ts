import { useSyncExternalStore } from 'react'

export type SessionLanguage = 'en' | 'zh'

export const SESSION_LANGUAGE_STORAGE_KEY = 'spool-session-language'
export const SESSION_LANGUAGE_CHANGED = 'spool:session-language-changed'

declare global {
  interface WindowEventMap {
    [SESSION_LANGUAGE_CHANGED]: CustomEvent<SessionLanguage>
  }
}

const SERVER_LANGUAGE: SessionLanguage = 'en'
let volatilePreference: SessionLanguage | null = null
const subscribers = new Set<() => void>()
let stopBrowserListeners: (() => void) | null = null

export function normalizeSessionLanguage(value: string | null | undefined): SessionLanguage | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return null
}

function storedSessionLanguage(): SessionLanguage | null {
  if (typeof window === 'undefined') return null
  try {
    return normalizeSessionLanguage(window.localStorage.getItem(SESSION_LANGUAGE_STORAGE_KEY))
  } catch {
    return null
  }
}

function browserSessionLanguage(): SessionLanguage {
  if (typeof navigator === 'undefined') return SERVER_LANGUAGE
  return normalizeSessionLanguage(navigator.language) ?? SERVER_LANGUAGE
}

export function readSessionLanguage(): SessionLanguage {
  return volatilePreference ?? storedSessionLanguage() ?? browserSessionLanguage()
}

export function sessionLanguageTag(language: SessionLanguage): 'en' | 'zh-CN' {
  return language === 'zh' ? 'zh-CN' : 'en'
}

export function setSessionLanguage(language: SessionLanguage) {
  if (typeof window === 'undefined') return
  volatilePreference = language
  try {
    window.localStorage.setItem(SESSION_LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Keep the in-memory preference for private or storage-constrained contexts.
  }
  window.dispatchEvent(new CustomEvent(SESSION_LANGUAGE_CHANGED, { detail: language }))
}

function notifySubscribers() {
  for (const subscriber of subscribers) subscriber()
}

function listenToBrowserLanguage() {
  const onPreferenceChange = (event: WindowEventMap[typeof SESSION_LANGUAGE_CHANGED]) => {
    volatilePreference = event.detail
    notifySubscribers()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_LANGUAGE_STORAGE_KEY) return
    volatilePreference = normalizeSessionLanguage(event.newValue)
    notifySubscribers()
  }
  const onBrowserLanguageChange = () => {
    if (volatilePreference || storedSessionLanguage()) return
    notifySubscribers()
  }

  window.addEventListener(SESSION_LANGUAGE_CHANGED, onPreferenceChange)
  window.addEventListener('storage', onStorage)
  window.addEventListener('languagechange', onBrowserLanguageChange)
  return () => {
    window.removeEventListener(SESSION_LANGUAGE_CHANGED, onPreferenceChange)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('languagechange', onBrowserLanguageChange)
  }
}

function subscribeToSessionLanguage(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  subscribers.add(onStoreChange)
  if (!stopBrowserListeners) stopBrowserListeners = listenToBrowserLanguage()

  return () => {
    subscribers.delete(onStoreChange)
    if (subscribers.size !== 0) return
    stopBrowserListeners?.()
    stopBrowserListeners = null
  }
}

export function useSessionLanguage(): SessionLanguage {
  return useSyncExternalStore(
    subscribeToSessionLanguage,
    readSessionLanguage,
    () => SERVER_LANGUAGE,
  )
}
