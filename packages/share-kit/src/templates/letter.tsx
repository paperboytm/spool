// Template: Letter — single-column, generous margins, literary.
//
// Complementary to the other templates:
//   • Forum    = threaded posts, session-detail feel
//   • Letter   = spacious single-column, reading-first
//   • Chat     = bubble flow
//   • Timeline = time-anchored rail
//
// Letter is the "cover letter / essay" look. Full conversation
// rendered in one calm column. Accent color appears on the title's
// underscore and each user's byline — the colorway picker is visible
// at a glance.

import type { Conversation, EditorOpts } from '@/lib/types'
import { typefaceFamily } from '@/lib/types'
import { accentBgFor, templateTokens, bodyStyleVars, BODY_VAR_PROPS } from './tokens'
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

export function Letter({ convo, opts, redactList: injectedRedactList }: Props) {
  const t = templateTokens(opts.paper)
  const accent = opts.accentHex
  const accentBg = accentBgFor(accent)
  const tf = typefaceFamily(opts.typeface)
  const redactList = useResolvedRedactList(convo.turns, opts, injectedRedactList)
  const turnGap = opts.density === 'compact' ? 20 : 32
  const segments = selectSegments(convo, opts)

  return (
    <div
      style={{
        ...bodyStyleVars({ accent, accentBg, bodyFont: tf, blockBorder: t.border }),
        fontFamily: tf,
        background: t.paper,
        color: t.text,
        padding: '72px 80px 56px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Masthead */}
      {opts.showMasthead && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.03em' }}>
            Spool<span style={{ color: accent }}>.</span>
          </span>
          <span
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 10,
              color: accent,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            § Letter
          </span>
        </div>
      )}

      {/* Title block */}
      <h1
        style={{
          fontFamily: tf,
          fontWeight: 600,
          fontSize: 34,
          letterSpacing: '-0.025em',
          lineHeight: 1.1,
          margin: '0 0 14px',
          color: t.text,
          maxWidth: '92%',
        }}
      >
        {convo.title}
      </h1>
      <div
        style={{
          width: 64,
          height: 3,
          background: accent,
          borderRadius: 1,
          marginBottom: 14,
        }}
      />
      <div
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 11,
          color: t.muted,
          letterSpacing: '0.04em',
        }}
      >
        with {convo.sourceLabel} · {segments.isExcerpt
          ? `${segments.kept} of ${segments.total} turns`
          : `${segments.total} turns`} · ~{convo.readMin} min · Stitched {convo.createdAt}
      </div>

      {/* Body */}
      <div
        style={{
          marginTop: 40,
          display: 'flex',
          flexDirection: 'column',
          gap: turnGap,
        }}
      >
        {segments.turns.map((turn, i) => (
          <div key={turn.origIndex} data-turn-index={turn.origIndex} style={{ scrollMarginTop: 40 }}>
            {opts.showGaps && segments.gapBefore[i]! > 0 && (
              <div style={{ marginBottom: turnGap }}>
                <GapMarker count={segments.gapBefore[i]!} tokens={t} accent={accent} />
              </div>
            )}
            <div data-turn-body>
              <div
                style={{
                  fontFamily: tf,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: turn.role === 'user' ? t.muted : accent,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: turn.role === 'user' ? 4 : 10,
                    height: 2,
                    background: turn.role === 'user' ? t.muted : accent,
                    opacity: turn.role === 'user' ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                />
                {turn.role === 'user' ? (turn.author ?? 'User').replace(/[\[\]]/g, '') : convo.sourceLabel}
              </div>
              <Body
                text={turn.body}
                redact={opts.redact ? redactList : undefined}
                {...BODY_VAR_PROPS}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Colophon */}
      {opts.showColophon && (
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontFamily: 'Geist Mono, monospace',
            fontSize: 10,
            color: t.faint,
            letterSpacing: '0.04em',
          }}
        >
          <span>
            Stitched on Spool<span style={{ color: accent }}>.</span>
          </span>
          <span style={{ color: accent }}>— 1 —</span>
        </div>
      )}
    </div>
  )
}
