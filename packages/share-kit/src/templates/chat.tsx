// Template: Chat — messenger-style bubbles. User turns render as
// rounded bubbles pinned to the right; assistant turns flow as plain
// editorial text on the left with a small source kicker. Meant to
// evoke the native chat UI of ChatGPT/Claude/Gemini while still
// reading as a considered artifact.

import type { Conversation, EditorOpts } from '@/lib/types'
import { typefaceFamily } from '@/lib/types'
import { accentBgFor, templateTokens, bodyStyleVars, BODY_VAR_PROPS, BODY_VAR_BLOCK_BORDER } from './tokens'
import { useResolvedRedactList, type RedactReplacement } from './redact'
import { selectSegments } from './selection'
import { GapMarker } from './gap-marker'
import { Body } from './body'

interface Props {
  convo: Conversation
  opts: EditorOpts
  /** Host-provided stable redact list — see TemplateRender's prop doc. */
  redactList?: RedactReplacement[] | undefined
}

export function Chat({ convo, opts, redactList: injectedRedactList }: Props) {
  const t = templateTokens(opts.paper)
  const accent = opts.accentHex
  const accentBg = accentBgFor(accent)
  const tf = typefaceFamily(opts.typeface)
  const redactList = useResolvedRedactList(convo.turns, opts, injectedRedactList)
  const segments = selectSegments(convo, opts)
  const turnGap = opts.density === 'compact' ? 20 : 30

  return (
    <div
      style={{
        ...bodyStyleVars({ accent, accentBg, bodyFont: tf, blockBorder: t.border }),
        fontFamily: tf,
        background: t.paper,
        color: t.text,
        width: '100%',
        padding: '48px 56px 44px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {opts.showMasthead && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.03em' }}>
            Spool<span style={{ color: accent }}>.</span>
          </span>
          <span style={{ flex: 1, height: 1, background: t.border }} />
          <span
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 10,
              color: accent,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            § Chat
          </span>
          <span style={{ flex: 1, height: 1, background: t.border }} />
          <span
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 10,
              color: t.muted,
              letterSpacing: '0.04em',
            }}
          >
            {convo.sourceLabel} · {convo.createdAt}
          </span>
        </div>
      )}

      <h2
        style={{
          fontWeight: 600,
          fontSize: 22,
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          margin: 0,
        }}
      >
        {convo.title}
      </h2>
      <div style={{ width: 36, height: 2, background: accent, borderRadius: 1, marginTop: 10, marginBottom: 26 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: turnGap }}>
        {segments.turns.map((turn, i) => {
          const isUser = turn.role === 'user'
          const showGap = opts.showGaps && segments.gapBefore[i]! > 0
          return (
            <div
              key={turn.origIndex}
              data-turn-index={turn.origIndex}
              style={{ scrollMarginTop: 40, display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {showGap && <GapMarker count={segments.gapBefore[i]!} tokens={t} accent={accent} />}
              {isUser ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    data-turn-body
                    style={{
                      maxWidth: '74%',
                      background: t.surface,
                      color: t.text,
                      padding: '12px 16px',
                      borderRadius: 18,
                      borderBottomRightRadius: 6,
                      fontSize: 13.5,
                      lineHeight: 1.55,
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
              ) : (
                <div data-turn-body style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 18,
                        height: 18,
                        color: accent,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
                        <path d="M7 0.5 L8.3 5.2 L13 6.5 L8.3 7.8 L7 12.5 L5.7 7.8 L1 6.5 L5.7 5.2 Z" />
                      </svg>
                    </span>
                    <span
                      style={{
                        fontFamily: 'Geist Mono, monospace',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: accent,
                      }}
                    >
                      {convo.sourceLabel}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: tf,
                      fontSize: 13.5,
                      lineHeight: 1.7,
                      color: t.text,
                      paddingLeft: 26,
                    }}
                  >
                    <Body
                      text={turn.body}
                      redact={opts.redact ? redactList : undefined}
                      fontSize={13.5}
                      {...BODY_VAR_PROPS}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {opts.showColophon && (
        <div
          style={{
            marginTop: 36,
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'Geist Mono, monospace',
            fontSize: 9.5,
            color: t.faint,
            letterSpacing: '0.04em',
          }}
        >
          <span>Stitched on Spool</span>
          {convo.shortUrl && <span>{convo.shortUrl}</span>}
        </div>
      )}
    </div>
  )
}
