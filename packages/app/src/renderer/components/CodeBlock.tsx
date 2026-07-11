import { memo, useEffect, useState } from 'react'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

interface Props {
  code: string
  lang?: string
  isDark: boolean
}

let highlighterPromise: Promise<HighlighterCore> | null = null

const HTML_CACHE_MAX = 500
const htmlCache = new Map<string, string>()

function cacheGet(key: string): string | undefined {
  const value = htmlCache.get(key)
  if (value !== undefined) {
    htmlCache.delete(key)
    htmlCache.set(key, value)
  }
  return value
}

function cacheSet(key: string, value: string): void {
  if (htmlCache.size >= HTML_CACHE_MAX) {
    const oldest = htmlCache.keys().next().value
    if (oldest !== undefined) htmlCache.delete(oldest)
  }
  htmlCache.set(key, value)
}

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  py: 'python',
  md: 'markdown',
}

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise
  highlighterPromise = createHighlighterCore({
    themes: [
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ],
    langs: [
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/tsx.mjs'),
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/jsx.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/bash.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/markdown.mjs'),
    ],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighterPromise
}

function resolveLang(lang: string | undefined, loaded: ReadonlyArray<string>): string {
  if (!lang) return 'text'
  const normalized = LANG_ALIASES[lang] ?? lang
  return loaded.includes(normalized) ? normalized : 'text'
}

function CodeBlock({ code, lang, isDark }: Props) {
  const [html, setHtml] = useState<string | null>(null)
  const reservedLines = Math.max(1, code.split('\n').length)

  useEffect(() => {
    let cancelled = false
    const key = `${isDark ? 1 : 0}:${lang ?? ''}:${code}`
    const cached = cacheGet(key)
    if (cached) {
      setHtml(cached)
      return
    }
    void (async () => {
      try {
        const highlighter = await getHighlighter()
        const loaded = highlighter.getLoadedLanguages()
        const targetLang = resolveLang(lang, loaded)
        const rendered = highlighter.codeToHtml(code, {
          lang: targetLang,
          theme: isDark ? 'github-dark' : 'github-light',
        })
        cacheSet(key, rendered)
        if (!cancelled) setHtml(rendered)
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[CodeBlock] highlight failed', err)
        }
      }
    })()
    return () => { cancelled = true }
  }, [code, lang, isDark])

  if (html) {
    // The placeholder→highlighted swap changes row height. MessageList's per-row
    // measureElement uses ResizeObserver, so the virtual list re-measures automatically.
    return (
      <div
        className="my-2 text-[13px] leading-snug rounded-md overflow-x-auto bg-warm-surface2 dark:bg-dark-surface2 border border-warm-border dark:border-dark-border [&_pre]:!bg-transparent [&_pre]:p-3"
        // shiki output is generated from a known string; not user HTML.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre
      className="my-2 p-3 rounded-md overflow-x-auto bg-warm-surface2 dark:bg-dark-surface2 border border-warm-border dark:border-dark-border text-[13px] leading-snug font-mono"
      style={{ minHeight: `${reservedLines * 1.4}em` }}
    >
      <code>{code}</code>
    </pre>
  )
}

export default memo(CodeBlock)
