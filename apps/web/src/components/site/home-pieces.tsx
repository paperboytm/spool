/* Shared homepage building blocks: the pieces every layout variant
 * composes — command pill, section head, goal-route map, flow animation,
 * and the closing CTA. */
import { Button, ButtonLink } from '@spool-lab/ui'
import { useState } from 'react'

import { SpoolMark } from './spool-mark'

export const SHARE_CMD = 'npx @spool-lab/cli share'

export function ShareCommandPill() {
  const [copied, setCopied] = useState(false)
  const onClick = () => {
    void navigator.clipboard
      .writeText(SHARE_CMD)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {})
  }
  return (
    <Button
      type="button"
      className={`hh-install${copied ? ' is-copied' : ''}`}
      variant="outline"
      onClick={onClick}
      aria-label="Copy share command"
    >
      <span className="tick">$</span>
      <code>{SHARE_CMD}</code>
      <span className="copy">
        {copied ? (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </Button>
  )
}

export function PillarHead({
  kicker,
  title,
  sub,
}: {
  kicker: string
  title: React.ReactNode
  sub: React.ReactNode
}) {
  return (
    <div className="s-head s-head-edit">
      <div className="s-kick">{kicker}</div>
      <h2 className="s-title">{title}</h2>
      <p className="s-sub">{sub}</p>
    </div>
  )
}

/* Spool's session view, distilled into a route map: the agent's
 * trajectory winds toward the /goal, forks into attempts that dead-end,
 * and the surviving route flows on until it lands. */
export function GoalTrail() {
  const MAIN =
    'M36 218 C90 192 98 152 150 148 C202 144 212 190 262 186 C304 183 310 142 342 118 C370 97 424 94 456 62'
  return (
    <div className="gt">
      <div className="gt-bar">
        <span className="fs-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="gt-title">claude_7a55b1ee · route map</span>
        <span className="hh-bd hh-bd-claude">claude</span>
      </div>
      <div className="gt-body">
        <div className="gt-goal">
          <span className="gt-goal-k">/goal</span>
          <span className="gt-goal-t">refresh must survive two tabs racing</span>
        </div>

        <svg
          className="gtm"
          viewBox="0 0 520 264"
          role="img"
          aria-label="The agent's route toward the goal: two attempts dead-end, the third lands"
        >
          <defs>
            <pattern id="gtmDots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.1" fill="var(--border)" />
            </pattern>
          </defs>
          <rect width="520" height="264" fill="url(#gtmDots)" opacity="0.6" />

          {/* attempts that dead-ended */}
          <path className="gtm-dead" d="M150 148 C160 118 148 96 178 74" />
          <path className="gtm-dead" d="M262 186 C294 210 330 216 358 202" />

          {/* the surviving route */}
          <path className="gtm-route gtm-glow" d={MAIN} />
          <path className="gtm-route gtm-base" d={MAIN} />
          <path className="gtm-route gtm-flow" d={MAIN} />

          {/* waypoints where the route turned */}
          <circle className="gtm-wp" cx="150" cy="148" r="4" />
          <circle className="gtm-wp" cx="262" cy="186" r="4" />
          <circle className="gtm-wp" cx="342" cy="118" r="4" />

          {/* start */}
          <circle className="gtm-start" cx="36" cy="218" r="5" />
          <text className="gtm-lbl" x="24" y="242">
            prompt · turn 1
          </text>

          {/* dead ends */}
          <g className="gtm-x" transform="translate(178, 74)">
            <circle r="8" />
            <path d="M-3 -3 L3 3 M3 -3 L-3 3" />
          </g>
          <text className="gtm-lbl" x="178" y="44" textAnchor="middle">
            per-request debounce
          </text>
          <text className="gtm-lbl gtm-lbl-faint" x="178" y="56" textAnchor="middle">
            dead end · turn 3
          </text>

          <g className="gtm-x" transform="translate(358, 202)">
            <circle r="8" />
            <path d="M-3 -3 L3 3 M3 -3 L-3 3" />
          </g>
          <text className="gtm-lbl" x="358" y="226" textAnchor="middle">
            localStorage lock
          </text>
          <text className="gtm-lbl gtm-lbl-faint" x="358" y="238" textAnchor="middle">
            dead end · turn 9
          </text>

          {/* the stretch that landed */}
          <text className="gtm-lbl gtm-lbl-strong" x="296" y="88">
            single-flight · turn 14
          </text>

          {/* goal */}
          <g className="gtm-goal-mark">
            <circle className="gtm-goal-ring" cx="456" cy="62" r="14" />
            <circle className="gtm-goal-core" cx="456" cy="62" r="6.5" />
          </g>
          <text className="gtm-lbl gtm-lbl-accent" x="456" y="34" textAnchor="middle">
            /goal reached
          </text>
        </svg>

        <div className="gt-done">
          <span className="gt-done-check">✓</span>
          <span className="gt-done-t">/goal reached</span>
          <span className="gt-done-meta">+214 −63 · tests green</span>
        </div>
      </div>
    </div>
  )
}

/* Choreographed loop (18s, pure CSS — see the fs* keyframes): the
 * session streams into machine A; `spool share` + option confirm; a
 * particle carries it into the Spool knowledge server; the public URL
 * appears; machine B wakes and types `spool resume`; a particle flows
 * into B and the chat streams on. Reduced motion shows the completed
 * state. */
export function FlowShow() {
  return (
    <div
      className="fs"
      aria-label="A Session shared from laptop A through the Spool server and resumed on laptop B"
    >
      <div className="fs-laptop">
        <div className="fs-lscreen">
          <div className="fs-win">
            <div className="fs-winbar">
              <span className="fs-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="fs-wintitle">claude · ~/code/harbor</span>
              <span className="hh-bd hh-bd-claude">claude</span>
            </div>
            <div className="fs-winbody">
              <span className="fs-line fs-al fs-a1" style={{ width: '74%' }} />
              <span className="fs-line fs-dim fs-al fs-a2" style={{ width: '48%' }} />
              <span className="fs-line fs-al fs-a3" style={{ width: '62%' }} />
              <div className="fs-cmd fs-cmd-share">
                <span className="acc">$</span>{' '}
                <span className="fs-type fs-type-a">spool share</span>
                <span className="fs-caret fs-caret-a" aria-hidden />
              </div>
              <div className="fs-sel">
                ? Publish as Public? · <b>Yes</b>
              </div>
            </div>
          </div>
        </div>
        <div className="fs-ldeck" aria-hidden />
        <div className="fs-lwho">@maya · machine A</div>
      </div>

      <div className="fs-hub">
        <div className="fs-hub-node">
          <span className="fs-hub-ring" aria-hidden />
          <SpoolMark size={24} />
          <span className="fs-hub-rows" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="fs-pill">
          <span className="fs-url">spool.new/session/claude_7a55b1ee</span>
          <span className="fs-vis">Public</span>
        </div>
      </div>

      <div className="fs-laptop">
        <div className="fs-lscreen">
          <div className="fs-win fs-win-b">
            <div className="fs-winbar">
              <span className="fs-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="fs-wintitle">claude · ~/code/harbor</span>
              <span className="hh-bd hh-bd-claude">claude</span>
            </div>
            <div className="fs-winbody">
              <div className="fs-cmd fs-cmd-resume">
                <span className="acc">$</span>{' '}
                <span className="fs-type fs-type-b">spool resume claude_7a55b1ee</span>
                <span className="fs-caret fs-caret-b" aria-hidden />
              </div>
              <span className="fs-line fs-cont fs-c1" style={{ width: '68%' }} />
              <span className="fs-line fs-dim fs-cont fs-c2" style={{ width: '44%' }} />
              <span className="fs-line fs-cont fs-c3" style={{ width: '56%' }} />
              <span className="fs-line fs-ok fs-cont fs-c4" style={{ width: '36%' }} />
            </div>
          </div>
        </div>
        <div className="fs-ldeck" aria-hidden />
        <div className="fs-lwho">@arjun · machine B</div>
      </div>

      <span className="fs-orb fs-orb-a" aria-hidden>
        <i />
      </span>
      <span className="fs-orb fs-orb-b" aria-hidden>
        <i />
      </span>
    </div>
  )
}

export function FinalCTA({ centered = false }: { centered?: boolean } = {}) {
  return (
    <section className={`final reveal${centered ? ' final-center' : ''}`}>
      <div className="big">
        Make agent work
        <br />
        <em>team knowledge</em>
        <span className="accent">.</span>
      </div>
      <div className="row">
        <ShareCommandPill />
        <ButtonLink href="/explore" className="hh-btn" variant="accent">
          Explore Sessions →
        </ButtonLink>
        <ButtonLink href="/docs/quick-start" className="hh-btn" variant="outline">
          Share yours →
        </ButtonLink>
      </div>
    </section>
  )
}
