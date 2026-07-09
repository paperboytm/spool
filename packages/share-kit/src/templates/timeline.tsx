// Template: Timeline — time as the spine of the conversation.
//
// A vertical hairline rule runs down the left of the body. Each turn
// drops a dot on the rail; the timestamp lives in the left gutter,
// the role + body on the right. Long pauses in the original
// conversation render as labeled negative space — the rail
// literally breathes where the user paused. Distinct from chat
// (no bubbles, no side-alternation), letter (rail spine + per-turn
// markers, not label-on-top), and forum (threaded posts with avatars).
//
// Legacy drafts saved before `Turn.timestamp` existed gracefully
// degrade: the gutter shows a dash and no gaps are drawn.

import type { Conversation, EditorOpts } from '@/lib/types'
import { typefaceFamily } from '@/lib/types'
import { accentBgFor, templateTokens, bodyStyleVars, BODY_VAR_PROPS } from './tokens'
import { useResolvedRedactList, type RedactReplacement } from './redact'
import { selectSegments } from './selection'
import { Body } from './body'

interface Props {
  convo: Conversation
  opts: EditorOpts
  /** Host-provided stable redact list — see TemplateRender's prop doc. */
  redactList?: RedactReplacement[] | undefined
}

export function Timeline({ convo, opts, redactList: injectedRedactList }: Props) {
  const t = templateTokens(opts.paper)
  const accent = opts.accentHex
  const accentBg = accentBgFor(accent)
  const tf = typefaceFamily(opts.typeface)
  const redactList = useResolvedRedactList(convo.turns, opts, injectedRedactList)
  const segments = selectSegments(convo, opts)
  const turnGap = opts.density === 'compact' ? 18 : 28

  return (
    <div
      style={{
        ...bodyStyleVars({ accent, accentBg, bodyFont: tf, blockBorder: t.border }),
        fontFamily: tf,
        background: t.paper,
        color: t.text,
        padding: '64px 56px 48px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {opts.showMasthead && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 22,
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
            § Timeline
          </span>
        </div>
      )}

      <h1
        style={{
          fontFamily: tf,
          fontWeight: 600,
          fontSize: 30,
          letterSpacing: '-0.025em',
          lineHeight: 1.12,
          margin: '0 0 12px',
          color: t.text,
          maxWidth: '92%',
        }}
      >
        {convo.title}
      </h1>
      <div style={{ width: 56, height: 2.5, background: accent, borderRadius: 1, marginBottom: 12 }} />
      <div
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 10,
          color: t.muted,
          letterSpacing: '0.04em',
        }}
      >
        with {convo.sourceLabel} · {formatStartDate(segments.turns, convo.createdAt)} · {segments.isExcerpt
          ? `${segments.kept} of ${segments.total} turns`
          : `${segments.total} turns`} · ~{convo.readMin} min
      </div>

      {/* Body: rail + dotted turns.
          Each turn div carries the gutter padding itself — putting it on
          the outer wrapper would offset turn-relative absolute children
          (timestamp, dot) by the padding, pushing them next to the role
          label instead of into the gutter. */}
      <div style={{ position: 'relative', marginTop: 36 }}>
        {/* The rail itself — a hairline rule from the top of the first
            dot to the bottom of the last dot. Uses t.muted (not t.border)
            so it reads as an intentional axis rather than a hidden
            divider — t.border on light papers (snow / bone) fades into
            the paper tone. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 62,
            top: 4,
            bottom: 4,
            width: 1,
            background: t.muted,
            opacity: 0.35,
          }}
        />

        {segments.turns.map((turn, i) => {
          const isUser = turn.role === 'user'
          const prev = i > 0 ? (segments.turns[i - 1] ?? null) : null
          const showSkippedGap = opts.showGaps && segments.gapBefore[i]! > 0
          const dayChangeLabel = computeDayChangeLabel(prev, turn)
          const stamp = formatStamp(turn.timestamp)
          const hasMarker = showSkippedGap || dayChangeLabel != null
          const roleColor = isUser ? t.muted : accent

          return (
            <div key={turn.origIndex}>
              {/* Marker — standalone band on the timeline, BEFORE the
                  turn. No dot, no timestamp; the rail crosses through
                  it. Vertical breathing room on both sides so it reads
                  as an independent annotation rather than the turn's
                  first row. */}
              {hasMarker && (
                <div
                  aria-hidden
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    paddingLeft: 78,
                    margin: `${Math.round(turnGap * 0.5)}px 0`,
                    fontFamily: 'Geist Mono, monospace',
                    fontSize: 9,
                    color: t.muted,
                    letterSpacing: '0.1em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dayChangeLabel && (
                    <span style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                      <span style={{ color: accent, marginRight: 4 }}>—</span>
                      {dayChangeLabel}
                      <span style={{ color: accent, marginLeft: 4 }}>—</span>
                    </span>
                  )}
                  {showSkippedGap && (
                    <span style={{ textTransform: 'uppercase' }}>
                      <span style={{ color: accent, marginRight: 4 }}>⋯</span>
                      {segments.gapBefore[i]} turn{segments.gapBefore[i] === 1 ? '' : 's'} skipped
                    </span>
                  )}
                </div>
              )}

              <div
                data-turn-index={turn.origIndex}
                style={{
                  marginBottom: turnGap,
                  scrollMarginTop: 40,
                }}
              >
                <div data-turn-body>
                  {/* Header row: timestamp + dot + role label. Flex with
                      alignItems: center guarantees all three sit on the
                      same optical line — manual top values across
                      different intrinsic heights drifted by a sub-pixel
                      and looked off. Column widths sum so the dot lands
                      at x=62.5 (rail center): 54 + 4 + 9/2 = 62.5. */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span
                      style={{
                        width: 54,
                        flex: 'none',
                        textAlign: 'right',
                        fontFamily: 'Geist Mono, monospace',
                        fontSize: 10,
                        color: t.muted,
                        letterSpacing: '0.04em',
                        lineHeight: 1,
                      }}
                    >
                      {stamp ?? ''}
                    </span>
                    <span
                      aria-hidden
                      style={{
                        position: 'relative',
                        width: 9,
                        height: 9,
                        marginLeft: 4,
                        flex: 'none',
                        borderRadius: '50%',
                        background: t.paper,
                        // Dot stays uniform across both roles — the
                        // colorway differentiation lives on the role
                        // label, not the rail marker. Keeps the rail
                        // reading as one continuous thread instead of
                        // alternating colored beads.
                        boxShadow: `inset 0 0 0 1px ${t.muted}`,
                        boxSizing: 'border-box',
                      }}
                    />
                    <span
                      style={{
                        marginLeft: 11,
                        fontFamily: 'Geist Mono, monospace',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: roleColor,
                        lineHeight: 1,
                      }}
                    >
                      {isUser ? (turn.author ?? 'you').replace(/[\[\]]/g, '') : convo.sourceLabel}
                    </span>
                  </div>
                  {/* Body content sits below the header, indented to
                      align with the role label's left edge (78 =
                      54+4+9+11). */}
                  <div style={{ paddingLeft: 78, marginTop: 8 }}>
                    <Body
                      text={turn.body}
                      redact={opts.redact ? redactList : undefined}
                      {...BODY_VAR_PROPS}
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
            marginTop: 40,
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
          <span style={{ color: accent }}>— {convo.createdAt} —</span>
        </div>
      )}
    </div>
  )
}

/** "10:14". The date context is established by the meta line and the
 *  inline day-change labels — the per-turn stamp stays compact to keep
 *  the rail gutter narrow. Returns null when no timestamp is available
 *  (legacy drafts). */
function formatStamp(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function localDayKey(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Compact date for the title meta — "Wed · 14 May 2026". Picks the
 *  first turn's timestamp when available; falls back to the
 *  Conversation's createdAt (which composeFromSession formats already).
 *  Returns a non-empty string in all cases so the meta line stays
 *  well-structured. */
function formatStartDate(
  turns: ReadonlyArray<{ timestamp?: string | undefined }>,
  fallback: string,
): string {
  const first = turns.find((tn) => tn.timestamp)?.timestamp
  if (first) {
    const d = new Date(first)
    if (!Number.isNaN(d.getTime())) {
      const wd = WEEKDAYS_SHORT[d.getDay()]
      const mo = MONTHS_SHORT[d.getMonth()]
      return `${wd} · ${d.getDate()} ${mo} ${d.getFullYear()}`
    }
  }
  return fallback
}

/** When the calendar day rolls between `prev` and `curr`, format the
 *  new day as "Thu · 15 May" (year suppressed — already shown in the
 *  meta line). Returns null when there's no change, or when timestamps
 *  are missing on either side. */
function computeDayChangeLabel(
  prev: { timestamp?: string | undefined } | null,
  curr: { timestamp?: string | undefined },
): string | null {
  if (!prev || !prev.timestamp || !curr.timestamp) return null
  const a = localDayKey(prev.timestamp)
  const b = localDayKey(curr.timestamp)
  if (!a || !b || a === b) return null
  const d = new Date(curr.timestamp)
  const wd = WEEKDAYS_SHORT[d.getDay()]
  const mo = MONTHS_SHORT[d.getMonth()]
  return `${wd} · ${d.getDate()} ${mo}`
}
