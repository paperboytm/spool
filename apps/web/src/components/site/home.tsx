import { Button, ButtonLink } from '@spool-lab/ui'
import { useEffect, useState } from 'react'

const SHARE_CMD = 'npx @spool-lab/cli share'

export default function HomePage() {
  useScrollReveal()
  return (
    <div className="home-page">
      <main className="wrap">
        <Hero />
      </main>

      <main className="wrap">
        <BrowseSection />
        <PinSection />
        <SearchSection />
        <AgentSection />
        <PrinciplesSection />
        <FinalCTA />
      </main>
    </div>
  )
}

function useScrollReveal() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    )
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

/* ───────────────────────────── Hero ───────────────────────────── */

function Hero() {
  return (
    <section className="home-hero">
      <div className="hh-meta">
        <span className="pulse" />
        <span className="ver">Early access</span>
        <span className="dot" />
        <span>Public discovery</span>
        <span className="dot" />
        <span>Claude Code · Codex CLI</span>
        <span className="dot" />
        <span>MIT</span>
      </div>

      <h1 className="hh-h1">
        Share agent work.
        <br />
        <em>Continue it</em>
        <span className="accent">.</span>
      </h1>

      <p className="hh-lede">
        Turn a real coding-agent Session into a durable link. Readers get the Summary, conversation,
        tool activity, files, and diff — then resume it as new work.
      </p>

      <div className="hh-cta">
        <ShareCommandPill />
        <ButtonLink href="/explore" className="hh-btn" variant="accent">
          Explore Sessions →
        </ButtonLink>
        <ButtonLink href="/docs/quick-start" className="hh-btn" variant="outline">
          Share yours →
        </ButtonLink>
      </div>

      <div className="hh-window">
        <div className="hh-titlebar">
          <span className="hh-traffic">
            <span className="r" />
            <span className="y" />
            <span className="g" />
          </span>
          <span className="hh-title">
            Spool<span className="a">.</span>
          </span>
          <span />
        </div>

        <div className="hh-body">
          <HeroSidebar />
          <HeroMain />
        </div>
      </div>
    </section>
  )
}

interface HeroProject {
  readonly name: string
  readonly count: number
  readonly dots: readonly string[]
  readonly active?: boolean
}

const HERO_PROJECTS: readonly HeroProject[] = [
  { name: 'Summary', count: 1, dots: ['claude'], active: true },
  { name: 'Conversation', count: 42, dots: ['claude'] },
  { name: 'Tool activity', count: 18, dots: ['claude'] },
  { name: 'Touched files', count: 7, dots: ['claude'] },
  { name: 'Diff', count: 214, dots: ['claude'] },
  { name: 'Source records', count: 96, dots: ['claude'] },
]

function HeroSidebar() {
  return (
    <aside className="hh-side">
      <div className="hh-wm">
        Spool<span className="a">.</span>
      </div>

      <div className="hh-search">
        <SearchIcon size={12} />
        <span className="ph">Find in Session…</span>
        <span className="kbd">⌘F</span>
      </div>

      <div className="hh-lbl">
        <span>Session</span>
        <span className="sort">Public</span>
      </div>

      {HERO_PROJECTS.map((p) => (
        <div key={p.name} className={`hh-pj${p.active ? ' is-active' : ''}`}>
          <FolderIcon />
          <span className="nm">{p.name}</span>
          <span className="dots">
            {p.dots.map((src, i) => (
              <span key={i} className="d" style={{ background: `var(--src-${src})` }} />
            ))}
          </span>
          <span className="cnt">{p.count}</span>
        </div>
      ))}

      <div className="hh-divider" />
      <div className="hh-pj is-loose">
        <FolderIcon dashed />
        <span className="nm">Record deep links</span>
        <span />
        <span className="cnt">96</span>
      </div>

      <div className="hh-foot">
        <span className="live" />
        <span>
          Source Session <strong>unchanged</strong>
        </span>
      </div>
    </aside>
  )
}

function HeroMain() {
  return (
    <div className="hh-main">
      <h2 className="hh-app-h">JWT rotation without double refresh</h2>
      <div className="hh-app-sub">@maya · shared 2h ago · Claude Code · Public</div>

      <div className="hh-feed">
        <div className="hh-seg">
          <span className="nm">Summary</span>
          <span className="ct">Interpretation</span>
          <span className="ln" />
        </div>

        <SessionRow
          src="claude"
          label="claude"
          title="Rotate refresh tokens without duplicating requests across browser tabs"
          meta="Authentication · session renewal · concurrency"
        />
        <SessionRow
          src="claude"
          label="claude"
          title="Added a single-flight refresh path and replay protection"
          meta="Implementation complete · tests passing"
        />
        <SessionRow
          src="claude"
          label="claude"
          title="Keep access tokens short-lived; rotate refresh tokens on every use"
          meta="Chosen after comparing three alternatives"
        />

        <div className="hh-seg hh-seg-2">
          <span className="nm">Machine-derived evidence</span>
          <span className="ln" />
        </div>

        <SessionRow
          src="claude"
          label="claude"
          title="18 tool calls across implementation and validation"
          meta="pnpm test · pnpm typecheck · git diff"
        />
        <SessionRow
          src="claude"
          label="claude"
          title="7 files touched · +214 / −63"
          meta="middleware.ts · token-store.ts · auth.test.ts"
        />
        <SessionRow
          src="claude"
          label="claude"
          title="Continue this work in a new native Session"
          meta="Source remains unchanged · lineage preserved"
        />
      </div>
    </div>
  )
}

function SessionRow({
  src,
  label,
  title,
  meta,
}: {
  src: 'claude' | 'codex' | 'gemini'
  label: string
  title: string
  meta: string
}) {
  const dimSeparators = (text: string) =>
    text.split(' · ').map((part, i, arr) => (
      <span key={i}>
        {part}
        {i < arr.length - 1 && <span className="dim"> · </span>}
      </span>
    ))
  return (
    <div className="hh-row">
      <span className={`hh-bd hh-bd-${src}`}>{label}</span>
      <div className="bod">
        <div className="ttl">{title}</div>
        <div className="mt">{dimSeparators(meta)}</div>
      </div>
      <span />
    </div>
  )
}

function ShareCommandPill() {
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

/* ─────────────────── Pillar sections (Browse / Pin / Search) ─────────────────── */

function PillarHead({
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

function BrowseSection() {
  return (
    <section className="pillar reveal">
      <PillarHead
        kicker="Share"
        title={
          <>
            One Session, <em>one durable link</em>
            <span className="accent">.</span>
          </>
        }
        sub="Choose a Session, review the exact record range and sensitive-data findings, add an optional Summary, and confirm. Every Share starts Link-only; Publish is the separate action that can add it to your Profile and Explore."
      />

      <div className="pillar-spec">
        <BrowseDiagram />
      </div>
    </section>
  )
}

function BrowseDiagram() {
  return (
    <div className="bd">
      <div className="bd-sources">
        <div className="bd-src">
          <div className="bd-src-head">
            <span className={`hh-bd hh-bd-claude`}>claude</span>
            <span className="bd-src-path">claude_7a55b1ee-…</span>
          </div>
          <div className="bd-src-files">
            <span>96 source records</span>
            <span>7 touched files · +214 / −63</span>
            <span className="bd-src-more">Source: Claude Code</span>
          </div>
        </div>

        <div className="bd-src">
          <div className="bd-src-head">
            <span className={`hh-bd hh-bd-claude`}>claude</span>
            <span className="bd-src-path">Sensitive-data gate</span>
          </div>
          <div className="bd-src-files">
            <span>Record range confirmed</span>
            <span>Potential secrets reviewed</span>
            <span className="bd-src-more">Nothing else on the machine is included</span>
          </div>
        </div>

        <div className="bd-src">
          <div className="bd-src-head">
            <span className={`hh-bd hh-bd-claude`}>claude</span>
            <span className="bd-src-path">Optional Summary</span>
          </div>
          <div className="bd-src-files">
            <span>Intent and outcome</span>
            <span>Key decisions</span>
            <span className="bd-src-more">Kept separate from machine evidence</span>
          </div>
        </div>

        <div className="bd-src bd-src-soon">
          <div className="bd-src-head">
            <span className="bd-soon-badge">share</span>
            <span className="bd-src-path">npx @spool-lab/cli share claude_7a55b1ee-…</span>
          </div>
        </div>
      </div>

      <div className="bd-arrow" aria-hidden>
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
        <span className="bd-arrow-lbl">explicit share</span>
      </div>

      <div className="bd-out">
        <div className="bd-out-head">
          <FolderIcon />
          <span className="bd-out-name">Shared Session</span>
          <span className="bd-out-meta">Public · source unchanged</span>
        </div>
        <div className="bd-out-stats">
          <div className="bd-out-stat">
            <span className="bd-stat-dot" style={{ background: 'var(--src-claude)' }} />
            <span className="bd-stat-num">1</span>
            <span className="bd-stat-lbl">Summary</span>
          </div>
          <div className="bd-out-stat">
            <span className="bd-stat-dot" style={{ background: 'var(--src-claude)' }} />
            <span className="bd-stat-num">96</span>
            <span className="bd-stat-lbl">records</span>
          </div>
          <div className="bd-out-stat">
            <span className="bd-stat-dot" style={{ background: 'var(--src-claude)' }} />
            <span className="bd-stat-num">7</span>
            <span className="bd-stat-lbl">files</span>
          </div>
        </div>
        <div className="bd-out-foot">
          <code>spool.pro/session/claude_7a55b1ee-…</code>
        </div>
      </div>
    </div>
  )
}

function PinSection() {
  return (
    <section className="pillar reveal">
      <PillarHead
        kicker="Read"
        title={
          <>
            Start with the outcome. <em>Go as deep as you need</em>
            <span className="accent">.</span>
          </>
        }
        sub="A Shared Session is more than a transcript. Summary explains the work; conversation and tool activity preserve the process; files and diff provide machine-derived evidence."
      />

      <div className="pillar-spec">
        <PinBoard />
      </div>
    </section>
  )
}

function PinBoard() {
  const pins = [
    {
      rotate: -2.4,
      src: 'claude' as const,
      project: 'summary',
      title: 'Intent, outcome, and the decisions that shaped the work',
      note: 'Interpretation for orientation — useful, but never presented as proof.',
      date: 'Start here',
    },
    {
      rotate: 1.6,
      src: 'claude' as const,
      project: 'conversation',
      title: 'Prompts, responses, pivots, and failed attempts in sequence',
      note: 'The original exchange stays available when the short version is not enough.',
      date: 'Process',
    },
    {
      rotate: -0.8,
      src: 'claude' as const,
      project: 'tools',
      title: 'Commands and tool activity connected to the relevant turns',
      note: 'Inspect what the agent actually ran instead of relying on a recap.',
      date: 'Evidence',
    },
    {
      rotate: 2.8,
      src: 'claude' as const,
      project: 'files + diff',
      title: 'Touched files and composed net changes',
      note: 'Git remains authoritative; Spool shows the evidence recorded in the Session.',
      date: 'Verify',
    },
  ]

  return (
    <div className="pb">
      <div className="pb-cork" aria-hidden />
      {pins.map((p, i) => (
        <div className="pb-card" key={i} style={{ transform: `rotate(${p.rotate}deg)` }}>
          <PinIcon />
          <div className="pb-card-meta">
            <span className={`hh-bd hh-bd-${p.src}`}>{p.src}</span>
            <span className="pb-card-pj">{p.project}</span>
            <span className="pb-card-date">{p.date}</span>
          </div>
          <div className="pb-card-title">{p.title}</div>
          <div className="pb-card-note">{p.note}</div>
        </div>
      ))}
    </div>
  )
}

function SearchSection() {
  return (
    <section className="pillar reveal">
      <PillarHead
        kicker="Resume"
        title={
          <>
            Continue the work without <em>changing the source</em>
            <span className="accent">.</span>
          </>
        }
        sub={
          <>
            <code>npx @spool-lab/cli resume</code> verifies the shared records, creates a new
            provider-native Session, and preserves where it came from. Choose a workspace and keep
            working in the agent you already use.
          </>
        }
      />

      <div className="pillar-spec">
        <CmdKOverlay />
      </div>
    </section>
  )
}

/* ───────────────────────── ⌘K overlay specimen ───────────────────────── */

function CmdKOverlay() {
  return (
    <div className="cmdk-stage">
      {/* faint shell hint behind the popup */}
      <div className="cmdk-bg" aria-hidden>
        <div className="cmdk-bg-side">
          <div className="cmdk-bg-wm" />
          <div className="cmdk-bg-search" />
          <div className="cmdk-bg-lbl" />
          <div className="cmdk-bg-pj" />
          <div className="cmdk-bg-pj" />
          <div className="cmdk-bg-pj" />
          <div className="cmdk-bg-pj" />
          <div className="cmdk-bg-pj" />
          <div className="cmdk-bg-pj" />
          <div className="cmdk-bg-pj" />
        </div>
        <div className="cmdk-bg-main">
          <div className="cmdk-bg-h" />
          <div className="cmdk-bg-sub" />
          <div className="cmdk-bg-row" />
          <div className="cmdk-bg-row" />
          <div className="cmdk-bg-row" />
          <div className="cmdk-bg-row" />
          <div className="cmdk-bg-row" />
        </div>
      </div>

      <div className="cmdk-pop">
        <div className="cmdk-bar">
          <SearchIcon size={16} />
          <span className="cmdk-q">
            npx @spool-lab/cli resume https://spool.pro/session/claude_…
          </span>
          <span className="cmdk-modes">
            <span className="cmdk-mode on" title="Verify">
              <BoltIcon />
            </span>
            <span className="cmdk-mode" title="Resume">
              <SparkleIcon />
            </span>
          </span>
        </div>

        <div className="cmdk-scope">
          <span className="cmdk-scope-lbl">CREATING:</span>
          <span className="cmdk-chip">new Session</span>
          <span className="cmdk-chip on">Source unchanged</span>
        </div>

        <div className="cmdk-results">
          <CmdKRow
            src="claude"
            label="claude"
            project="Records"
            title="96 objects verified against the source manifest"
            date="done"
          />
          <CmdKRow
            src="claude"
            label="claude"
            project="Project"
            title="~/code/harbor selected as the working directory"
            date="done"
          />
          <CmdKRow
            src="claude"
            label="claude"
            project="Source"
            title="Summary and continuation prelude attached"
            date="done"
          />
          <CmdKRow
            src="claude"
            label="claude"
            project="Claude"
            title="New provider-native Session prepared"
            date="ready"
          />
          <CmdKRow
            src="claude"
            label="claude"
            project="Spool"
            title="Source relationship preserved for the continuation"
            date="kept"
          />
        </div>

        <div className="cmdk-foot">
          <span className="cmdk-foot-l">Launch Claude Code ›</span>
          <span className="cmdk-foot-r">
            <span className="cmdk-kbd">↩</span>
            source unchanged
          </span>
        </div>
      </div>
    </div>
  )
}

function CmdKRow({
  src,
  label,
  project,
  title,
  date,
}: {
  src: 'claude' | 'codex' | 'gemini'
  label: string
  project: string
  title: React.ReactNode
  date: string
}) {
  return (
    <div className="cmdk-row">
      <span className={`hh-bd hh-bd-${src}`}>{label}</span>
      <span className="cmdk-pj">{project}</span>
      <span className="cmdk-ttl">{title}</span>
      <span className="cmdk-date">{date}</span>
    </div>
  )
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14.5 2 3 14h7l-1.5 8L21 10h-7l.5-8z" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5L3.5 11l6.5-2 2-6.5z" />
    </svg>
  )
}

/* ─────────────────────────── Agent integration ─────────────────────────── */

function AgentSection() {
  return (
    <section className="agent-sec reveal">
      <PillarHead
        kicker="Lineage"
        title={
          <>
            New work, with its <em>source still visible</em>
            <span className="accent">.</span>
          </>
        }
        sub={
          <>
            Resume materializes a fresh native Session instead of reopening or modifying the shared
            one. The continuation keeps a reference to its source and the exact point where the new
            work began.
          </>
        }
      />

      <div className="agent">
        <div className="notes">
          <div>
            <h3>01 — Resume creates, never mutates.</h3>
            <p>
              The Shared Session remains unchanged. The reader gets a new provider identifier and a
              clean place to continue the work.
            </p>
          </div>
          <div>
            <h3>02 — The authority stays clear.</h3>
            <p>
              The source Session is authoritative for agent work. The workspace and Git remain
              authoritative for code; Spool does not pretend to restore an entire repository.
            </p>
          </div>
          <div>
            <h3>03 — Continuation keeps its provenance.</h3>
            <p>
              The new Session records where it came from and which source records were resumed, so
              future readers can follow the relationship in either direction.
            </p>
          </div>
        </div>

        <div className="term">
          <div className="line">
            <span className="p">$</span> <span className="you">npx @spool-lab/cli resume</span>
          </div>
          <div className="line" style={{ marginTop: 10 }}>
            <span className="sys">&gt;</span>{' '}
            <span>https://spool.pro/session/claude_7a55b1ee-…</span>
          </div>
          <div className="line">
            <span className="sys">&gt;</span> <span>--workspace ~/code/harbor</span>
          </div>

          <div className="out">
            <div className="line">
              <span className="sys">◉</span>{' '}
              <span className="sys">Verifying and materializing the continuation…</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: 'color-mix(in srgb, var(--src-claude) 20%, transparent)',
                  color: 'var(--src-claude)',
                }}
              >
                claude
              </span>
              <span className="path">96 records</span>
              <span className="when">verified</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: 'color-mix(in srgb, var(--src-claude) 20%, transparent)',
                  color: 'var(--src-claude)',
                }}
              >
                claude
              </span>
              <span className="path">~/code/harbor</span>
              <span className="when">selected</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: 'color-mix(in srgb, var(--src-claude) 20%, transparent)',
                  color: 'var(--src-claude)',
                }}
              >
                claude
              </span>
              <span className="path">Claude Code continuation</span>
              <span className="when">created</span>
            </div>
          </div>

          <div className="inject">→ New Session ready · source unchanged · lineage preserved</div>
        </div>
      </div>
    </section>
  )
}

/* ──────────────────────────── Principles ──────────────────────────── */

function PrinciplesSection() {
  const principles = [
    {
      n: 'i.',
      title: 'Real Session, not a recap.',
      body: 'The original agent record stays authoritative. Presentation helps people read it without rewriting what happened.',
    },
    {
      n: 'ii.',
      title: 'Share first. Publish separately.',
      body: 'Share creates a Link-only URL for the chosen Session and record range. A separate Publish action makes it Public and discoverable.',
    },
    {
      n: 'iii.',
      title: 'Interpretation is not evidence.',
      body: 'Summary explains intent and outcome. Conversation, tools, files, and diff remain separate so readers can verify it.',
    },
    {
      n: 'iv.',
      title: 'Resume creates lineage.',
      body: 'Every continuation becomes new work with a visible source relationship. The Shared Session is never modified.',
    },
  ]
  return (
    <section className="reveal">
      <PillarHead
        kicker="Boundaries"
        title={
          <>
            Clear by default, <em>all the way through</em>
            <span className="accent">.</span>
          </>
        }
        sub="Spool keeps the sharing boundary, evidence, and continuation semantics explicit."
      />

      <div className="principles">
        {principles.map((p) => (
          <div className="principle" key={p.n}>
            <div className="p-num">{p.n}</div>
            <h4>{p.title}</h4>
            <p>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ──────────────────────────── Final CTA ──────────────────────────── */

function FinalCTA() {
  return (
    <section className="final reveal">
      <div className="big">
        Share the context.
        <br />
        <em>Continue the work</em>
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
      <div className="plat">Public discovery · Claude Code · Codex CLI · MIT</div>
    </section>
  )
}

/* ──────────────────────────── Icons ──────────────────────────── */

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      className="hh-pin"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" />
      <path d="M9 15l-4.5 4.5" fill="none" />
      <path d="M14.5 4l5.5 5.5" fill="none" />
    </svg>
  )
}

function FolderIcon({ dashed }: { dashed?: boolean }) {
  return (
    <svg
      width="14"
      height="11"
      viewBox="0 0 14 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={dashed ? { strokeDasharray: '2 2', opacity: 0.6 } : undefined}
    >
      <path d="M1 3.5a1 1 0 0 1 1-1h3l1.5 1.5h5.5a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3.5z" />
    </svg>
  )
}
