// Template: Forum — threaded posts, session-detail feel.
//
// Single column of "posts" stacked top-to-bottom: avatar + author
// header on top of each body, hairline separator between posts,
// post numbers on the right margin. Reads like a forum thread or a
// session-detail panel rather than chat bubbles or editorial prose.

import { useMemo } from 'react'
import type { Conversation, EditorOpts } from '@/lib/types'
import { typefaceFamily } from '@/lib/types'
import { accentBgFor, templateTokens, bodyStyleVars, BODY_VAR_PROPS, BODY_VAR_BLOCK_BORDER } from './tokens'
import { collectRedactList, type RedactReplacement } from './redact'
import { selectSegments } from './selection'
import { GapMarker } from './gap-marker'
import { Body } from './body'

interface Props {
  convo: Conversation
  opts: EditorOpts
  /** Host-provided stable redact list — see TemplateRender's prop doc. */
  redactList?: RedactReplacement[] | undefined
}

export function Forum({ convo, opts, redactList: injectedRedactList }: Props) {
  const t = templateTokens(opts.paper)
  const accent = opts.accentHex
  const accentBg = accentBgFor(accent)
  const tf = typefaceFamily(opts.typeface)
  const computedRedactList = useMemo(
    () => collectRedactList(convo.turns, opts),
    [convo.turns, opts.redactExclude],
  )
  const redactList = injectedRedactList ?? computedRedactList
  const segments = selectSegments(convo, opts)
  const postGap = opts.density === 'compact' ? 18 : 26
  const innerPad = opts.density === 'compact' ? 12 : 16

  return (
    <div
      style={{
        ...bodyStyleVars({ accent, accentBg, bodyFont: tf, blockBorder: t.border }),
        fontFamily: tf,
        background: t.paper,
        color: t.text,
        padding: '56px 56px 44px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {opts.showMasthead && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'Geist Mono, monospace',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ color: accent, fontWeight: 600 }}>§ Forum</span>
          <span style={{ flex: 1, height: 1, background: t.border }} />
          <span style={{ color: t.muted }}>{convo.sourceLabel}</span>
          <span style={{ color: t.muted }}>·</span>
          <span style={{ color: t.muted }}>
            {segments.isExcerpt
              ? `${segments.kept} / ${segments.total} posts`
              : `${segments.total} posts`}
          </span>
        </div>
      )}

      <h1
        style={{
          fontFamily: tf,
          fontWeight: 600,
          fontSize: 28,
          letterSpacing: '-0.025em',
          lineHeight: 1.15,
          margin: '20px 0 8px',
          color: t.text,
          maxWidth: '95%',
        }}
      >
        {convo.title}
      </h1>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'Geist Mono, monospace',
          fontSize: 10.5,
          color: t.muted,
          letterSpacing: '0.02em',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: accent,
          }}
        />
        <span>started {convo.createdAt}</span>
        <span aria-hidden style={{ color: t.faint }}>·</span>
        <span>{convo.wordCount.toLocaleString()} words</span>
        <span aria-hidden style={{ color: t.faint }}>·</span>
        <span>~{convo.readMin} min read</span>
      </div>
      <div style={{ height: 22 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: postGap }}>
        {segments.turns.map((turn, i) => {
          const isUser = turn.role === 'user'
          const displayName = isUser
            ? (turn.author ?? 'User').replace(/[\[\]]/g, '')
            : convo.sourceLabel
          const initials = initialsFor(displayName)
          const showGap = opts.showGaps && segments.gapBefore[i]! > 0
          const timestampLabel = turn.timestamp ? formatRelativeTimestamp(turn.timestamp) : undefined
          return (
            <div
              key={turn.origIndex}
              data-turn-index={turn.origIndex}
              style={{ scrollMarginTop: 40 }}
            >
              {showGap && (
                <div style={{ marginBottom: postGap }}>
                  <GapMarker count={segments.gapBefore[i]!} tokens={t} accent={accent} />
                </div>
              )}
              <div data-turn-body style={{ display: 'flex', gap: innerPad }}>
                {/* Avatar column */}
                <div style={{ flexShrink: 0 }}>
                  <div
                    aria-hidden
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: isUser ? 4 : '50%',
                      background: isUser ? t.surface : accent,
                      color: isUser ? t.text : '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'Geist Mono, monospace',
                      fontSize: 9.5,
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      border: isUser ? `1px solid ${t.border}` : 'none',
                    }}
                  >
                    {initials}
                  </div>
                </div>

                {/* Post column */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span
                        style={{
                          fontFamily: tf,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: t.text,
                          letterSpacing: '-0.005em',
                        }}
                      >
                        {displayName}
                      </span>
                      {timestampLabel && (
                        <>
                          <span aria-hidden style={{ color: t.faint, fontSize: 10 }}>·</span>
                          <span
                            style={{
                              fontFamily: 'Geist Mono, monospace',
                              fontSize: 10,
                              color: t.faint,
                              letterSpacing: '0.04em',
                            }}
                          >
                            {timestampLabel}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: tf,
                      fontSize: 13.5,
                      lineHeight: 1.65,
                      color: t.text,
                    }}
                  >
                    <Body
                      text={turn.body}
                      redact={opts.redact ? redactList : undefined}
                      fontSize={13.5}
                      {...BODY_VAR_PROPS}
                      blockBorder={BODY_VAR_BLOCK_BORDER}
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {opts.showColophon && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: 'Geist Mono, monospace',
            fontSize: 10,
            color: t.faint,
            marginTop: 24,
          }}
        >
          <span>
            Spool<span style={{ color: accent }}>.</span>
            {convo.shortUrl && <> · {convo.shortUrl}</>}
          </span>
          <span style={{ color: accent }}>thread closed</span>
        </div>
      )}
    </div>
  )
}

function initialsFor(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'U'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return parts[0]!.slice(0, 1).toUpperCase()
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

// Cross-day timestamp label. Mirrors the app's formatRelativeDate logic
// from packages/app/src/shared/formatDate.ts: same day → HH:MM; yesterday
// → "yesterday, HH:MM"; same year → "Mon DD"; otherwise → "Mon DD, YYYY".
function formatRelativeTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dayDiff = Math.round((startOfToday - startOfDay) / 86400000)
    const pad = (n: number) => n.toString().padStart(2, '0')
    const hhmmss = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (dayDiff <= 0) return hhmmss
    if (dayDiff === 1) return `yesterday, ${hhmm}`
    const locale = typeof document !== 'undefined' && document.documentElement.lang
      ? document.documentElement.lang
      : undefined
    if (d.getFullYear() === now.getFullYear()) {
      return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d)
    }
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
  } catch {
    return iso.slice(0, 10)
  }
}
