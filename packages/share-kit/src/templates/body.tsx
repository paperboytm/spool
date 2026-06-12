// Renders a conversation turn body as actual typeset markdown —
// headings become headings, **bold** actually bolds, bullets indent,
// fenced code blocks get their own treatment. Plus an in-line redact
// chip for auto-redacted spans.
//
// Why the code-span trick: react-markdown escapes HTML, so the
// simplest way to inject our custom redact chip is to preprocess the
// plain text — each detected literal is replaced with an inline code
// span carrying the per-kind mask text (e.g. `m***@example.com`,
// `[redacted: AWS key]`, `**** **** **** 1111`). A leading U+200B
// (zero-width space) tags those code spans as "redaction chips" so
// the `code` renderer can style them distinctly from ordinary inline
// code that happens to occur in the conversation. The ZWSP is
// invisible in the rendered output and survives the markdown export
// round-trip cleanly.

import { useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RedactReplacement } from './redact'

interface BodyProps {
  text: string
  redact?: RedactReplacement[] | undefined
  /** Monospace content — opt-in by templates that want a mono body. */
  mono?: boolean | undefined
  /** Override the sans-serif family used for non-mono bodies. Letter
   *  passes the user's typeface here so serif choices actually show
   *  up in the reading flow. */
  sansFont?: string | undefined
  /** Override the default body font size. Templates that mix
   *  prominent question text with quieter answer body (e.g. Interview)
   *  rely on this to keep the two streams visually distinct. */
  fontSize?: number | undefined
  accent: string
  accentBg: string
  /** Override the border color used for blockquotes and code blocks.
   *  When the outer container already carries an accent left border
   *  (e.g. an emphasized speaker block), pass a muted color here so nested block
   *  borders don't duplicate the outer rule. */
  blockBorder?: string | undefined
}

/**
 * Image renderer with a graceful fallback. ChatGPT/Claude/Gemini share
 * pages often include image URLs that either 404 quickly, are served
 * without permissive CORS, or are short-lived signed URLs. Rather than
 * showing the browser's broken-image glyph, render a quiet placeholder
 * box that preserves the alt text and clearly labels the media type.
 */
function MarkdownImage({ src, alt, accent }: { src?: string | undefined; alt?: string | undefined; accent: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>(src ? 'loading' : 'fail')
  return (
    <span
      style={{
        display: 'block',
        margin: '8px 0',
        padding: state === 'ok' ? 0 : '12px 14px',
        borderRadius: 3,
        background: state === 'ok' ? 'transparent' : 'rgba(128,128,128,0.06)',
        border: state === 'ok' ? 'none' : '1px dashed rgba(128,128,128,0.3)',
        textAlign: 'center',
      }}
    >
      {src && (
        <img
          src={src}
          alt={alt ?? ''}
          onLoad={() => setState('ok')}
          onError={() => setState('fail')}
          style={{
            display: state === 'ok' ? 'inline-block' : 'none',
            maxWidth: '100%',
            height: 'auto',
            borderRadius: 2,
            margin: 0,
          }}
        />
      )}
      {state !== 'ok' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={accent} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect x="2.5" y="2.5" width="13" height="13" rx="1.5" />
            <circle cx="6.5" cy="6.5" r="1.2" />
            <path d="M15 11l-3.5-3.5L4 14" />
          </svg>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, fontFamily: 'Geist, sans-serif' }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: accent, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {state === 'fail' ? 'Image' : 'Loading…'}
            </span>
            {alt && (
              <span style={{ fontSize: 12.5, color: 'inherit', opacity: 0.85, lineHeight: 1.35 }}>
                {alt}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  )
}

// Zero-width space prefixed to every redaction-chip code span so the
// `code` renderer can tell our chips apart from incidental inline
// code in the conversation. Invisible to readers; survives copy/
// paste and markdown export.
const REDACT_CHIP_MARKER = '​'

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function preprocess(text: string, redact?: RedactReplacement[]): string {
  if (!redact || redact.length === 0) return text
  const map = new Map(redact.map((r) => [r.value, r.replacement]))
  const rx = new RegExp(Array.from(map.keys()).map(escapeRx).join('|'), 'g')
  return text.replace(rx, (match) => {
    const mask = map.get(match) ?? '[redacted]'
    return '`' + REDACT_CHIP_MARKER + mask + '`'
  })
}

export function Body({ text, redact, mono, sansFont, fontSize: sizeOverride, accent, accentBg, blockBorder }: BodyProps) {
  const processed = useMemo(() => preprocess(text, redact), [text, redact])
  const blockStroke = blockBorder ?? accent

  const baseFont = mono
    ? "'Geist Mono', monospace"
    : sansFont ?? "'Geist', system-ui, sans-serif"
  const fontSize = sizeOverride ?? (mono ? 12 : 13)

  // react-markdown's Components type is broad enough that lambda params
  // don't inherit useful types via contextual typing. We accept any-typed
  // props here; the markdown library guarantees their runtime shape.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const components = useMemo<Components>(() => ({
    code({ className, children, node: _node, ...props }: any) {
      const codeText = String(children).replace(/\n$/, '')
      if (codeText.startsWith(REDACT_CHIP_MARKER)) {
        // Strip the marker before showing the per-kind mask.
        const label = codeText.slice(REDACT_CHIP_MARKER.length)
        return (
          <span
            style={{
              display: 'inline-block',
              padding: '0 4px',
              borderRadius: 2,
              background: accentBg,
              color: accent,
              fontFamily: 'Geist Mono, monospace',
              fontSize: '0.9em',
              letterSpacing: '0.02em',
            }}
          >
            {label}
          </span>
        )
      }
      // react-markdown v10: block code carries a `language-xxx` class
      // from the fence; inline code has no className.
      const isBlock = typeof className === 'string' && className.startsWith('language-')
      if (!isBlock) {
        return (
          <code
            className={className}
            {...props}
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: '0.92em',
              padding: '1px 5px',
              borderRadius: 3,
              background: 'rgba(128,128,128,0.12)',
              // Long unbreakable mono tokens (file paths, hashes) can blow
              // out of narrow containers. Break anywhere so the token stays
              // inside its column at the cost of mid-word linebreaks.
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {children}
          </code>
        )
      }
      return (
        <code className={className} {...props} style={{ fontFamily: 'Geist Mono, monospace', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          {children}
        </code>
      )
    },
    pre({ children }: { children?: React.ReactNode }) {
      return (
        <pre
          style={{
            background: 'rgba(128,128,128,0.08)',
            padding: '10px 12px',
            borderRadius: 3,
            overflow: 'auto',
            fontFamily: 'Geist Mono, monospace',
            fontSize: '0.92em',
            lineHeight: 1.55,
            margin: '8px 0',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {children}
        </pre>
      )
    },
    h1: (props: any) => <h3 style={headStyle(18)} {...props} />,
    h2: (props: any) => <h3 style={headStyle(16)} {...props} />,
    h3: (props: any) => <h3 style={headStyle(14)} {...props} />,
    h4: (props: any) => <h4 style={headStyle(13)} {...props} />,
    h5: (props: any) => <h4 style={headStyle(12)} {...props} />,
    h6: (props: any) => <h4 style={headStyle(12)} {...props} />,
    p: (props: any) => <p style={{ margin: '6px 0' }} {...props} />,
    ul: (props: any) => <ul style={{ margin: '4px 0', paddingLeft: 20, listStyle: 'disc' }} {...props} />,
    ol: (props: any) => <ol style={{ margin: '4px 0', paddingLeft: 20, listStyle: 'decimal' }} {...props} />,
    li: (props: any) => <li style={{ margin: '2px 0' }} {...props} />,
    strong: (props: any) => <strong style={{ color: 'inherit', fontWeight: 600 }} {...props} />,
    em: (props: any) => <em {...props} />,
    blockquote: (props: any) => (
      <blockquote
        style={{
          borderLeft: `2px solid ${blockStroke}`,
          margin: '6px 0',
          padding: '2px 0 2px 10px',
          opacity: 0.9,
        }}
        {...props}
      />
    ),
    hr: () => <hr style={{ border: 'none', borderTop: '1px solid currentColor', opacity: 0.2, margin: '10px 0' }} />,
    // Tables get explicit styles so desktop preview (Tailwind preflight
    // zeroes cell padding) and share-web (UA centers th) render identically.
    // react-markdown turns GFM column alignment into a `style` prop
    // (tableCellAlignToStyle), so incoming style must merge over ours.
    // `width: max-content` (no max-width) keeps every column at its
    // natural width — short cells never wrap; only cells past the
    // 360px cap do. Wide tables scroll inside the wrapper, whose
    // hover-reveal scrollbar lives in each consumer's stylesheet
    // (.spool-md-scroll).
    table: ({ node: _node, style, ...props }: any) => (
      <div className="spool-md-scroll" style={{ overflowX: 'auto', margin: '8px 0' }}>
        <table style={{ borderCollapse: 'collapse', width: 'max-content', ...style }} {...props} />
      </div>
    ),
    th: ({ node: _node, style, ...props }: any) => (
      <th
        style={{
          textAlign: 'left',
          fontWeight: 600,
          padding: '4px 8px',
          maxWidth: 360,
          borderBottom: '1px solid rgba(128,128,128,0.4)',
          ...style,
        }}
        {...props}
      />
    ),
    td: ({ node: _node, style, ...props }: any) => (
      <td
        style={{
          textAlign: 'left',
          padding: '4px 8px',
          maxWidth: 360,
          borderBottom: '1px solid rgba(128,128,128,0.18)',
          ...style,
        }}
        {...props}
      />
    ),
    a: ({ href, children }: { href?: string | undefined; children?: React.ReactNode }) => {
      // In-page anchors stay same-frame; everything else opens in a new
      // tab with `noreferrer noopener` so a reader click can't navigate
      // the top frame and the destination can't reach back through
      // `window.opener`. (react-markdown v10 already neutralizes
      // `javascript:`/`data:` hrefs via its default urlTransform, so no
      // extra sanitization is needed here.)
      const inPage = !!href && href.startsWith('#')
      return (
        <a
          href={href}
          {...(inPage ? {} : { target: '_blank', rel: 'noreferrer noopener' })}
          style={{ color: accent, textDecoration: 'none', borderBottom: `1px solid ${accent}`, overflowWrap: 'anywhere' }}
        >
          {children}
        </a>
      )
    },
    img: ({ src, alt }: { src?: string | undefined; alt?: string | undefined }) => <MarkdownImage src={src} alt={alt} accent={accent} />,
  }), [accent, accentBg, blockStroke])
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <div
      className="spool-body"
      style={{ fontFamily: baseFont, fontSize, lineHeight: mono ? 1.65 : 1.6, color: 'inherit' }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}

function headStyle(size: number): React.CSSProperties {
  return {
    fontFamily: 'Geist, sans-serif',
    fontSize: size,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    margin: '12px 0 6px',
    lineHeight: 1.25,
    color: 'inherit',
  }
}
