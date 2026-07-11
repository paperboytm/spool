import { useEffect, useRef, useState } from "react";

const INSTALL_CMD = "curl -fsSL https://spool.pro/install.sh | bash";

export default function HomePage() {
  useScrollReveal();
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
  );
}

function useScrollReveal() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ───────────────────────────── Hero ───────────────────────────── */

function Hero() {
  return (
    <section className="home-hero">
      <div className="hh-meta">
        <span className="pulse" />
        <span className="ver">v0.4.1</span>
        <span className="dot" />
        <span>local-first</span>
        <span className="dot" />
        <span>macOS · Apple Silicon</span>
        <span className="dot" />
        <span>MIT</span>
      </div>

      <h1 className="hh-h1">
        Your AI session
        <br />
        <em>library</em>
        <span className="accent">.</span>
      </h1>

      <p className="hh-lede">
        Every Claude, Codex, Gemini, and OpenCode session in one place. Browsable, pinnable, searchable —{" "}
        <strong>and never leaves your machine</strong>.
      </p>

      <div className="hh-cta">
        <InstallPill />
        <a href="https://github.com/spool-lab/spool" className="hh-btn hh-btn-p">
          <GhIcon />
          Star on GitHub
        </a>
        <a href="/docs/installation" className="hh-btn hh-btn-g">
          Read the docs →
        </a>
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
  );
}

interface HeroProject {
  readonly name: string;
  readonly count: number;
  readonly dots: readonly string[];
  readonly active?: boolean;
}

const HERO_PROJECTS: readonly HeroProject[] = [
  { name: "harbor", count: 142, dots: ["claude", "codex"], active: true },
  { name: "tide", count: 87, dots: ["claude", "gemini"] },
  { name: "prism", count: 53, dots: ["claude"] },
  { name: "forge", count: 41, dots: ["codex", "claude"] },
  { name: "ledger", count: 38, dots: ["gemini", "codex"] },
  { name: "atlas", count: 27, dots: ["claude"] },
  { name: "terra", count: 22, dots: ["gemini"] },
  { name: "relay", count: 19, dots: ["claude", "codex"] },
  { name: "vault", count: 14, dots: ["codex"] },
];

function HeroSidebar() {
  return (
    <aside className="hh-side">
      <div className="hh-wm">
        Spool<span className="a">.</span>
      </div>

      <div className="hh-search">
        <SearchIcon size={12} />
        <span className="ph">Search…</span>
        <span className="kbd">⌘K</span>
      </div>

      <div className="hh-lbl">
        <span>Projects</span>
        <span className="sort">recent ▾</span>
      </div>

      {HERO_PROJECTS.map((p) => (
        <div key={p.name} className={`hh-pj${p.active ? " is-active" : ""}`}>
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
        <span className="nm">Loose</span>
        <span />
        <span className="cnt">8</span>
      </div>

      <div className="hh-foot">
        <span className="live" />
        <span>
          <strong>462</strong> sessions · live
        </span>
      </div>
    </aside>
  );
}

function HeroMain() {
  return (
    <div className="hh-main">
      <h2 className="hh-app-h">AI Session Library</h2>
      <div className="hh-app-sub">
        All your AI conversations, organized by your code projects.
      </div>

      <div className="hh-feed">
        <div className="hh-seg">
          <span className="nm">Pinned</span>
          <span className="ct">3 sessions</span>
          <span className="ln" />
        </div>

        <SessionRow
          src="claude"
          title="auth middleware: JWT rotation with refresh tokens"
          meta="harbor · today · 42 messages · claude-sonnet-4-6"
          pinned
        />
        <SessionRow
          src="claude"
          title="webhook idempotency keys: design + migration plan"
          meta="ledger · 2d ago · 38 messages · claude-sonnet-4-6"
          pinned
        />
        <SessionRow
          src="gemini"
          title="RAG pipeline: llamaindex vs custom orchestration"
          meta="atlas · 4d ago · 27 messages · gemini-2.5-pro"
          pinned
        />
        <SessionRow
          src="codex"
          title="shared VPC peering: terraform module spec"
          meta="terra · 5d ago · 19 messages · gpt-5-codex"
          pinned
        />

        <div className="hh-seg hh-seg-2">
          <span className="nm">Today</span>
          <span className="ln" />
        </div>

        <SessionRow
          src="claude"
          title="rate limit middleware: token bucket impl"
          meta="harbor · 1h ago · 24 messages · claude-sonnet-4-6"
        />
        <SessionRow
          src="claude"
          title="gesture-handler v3 upgrade: breaking changes"
          meta="tide · today · 16 messages · claude-sonnet-4-6"
        />
        <SessionRow
          src="codex"
          title="checkout funnel A/B: pricing page variant"
          meta="tide · today · 16 messages · gpt-5-codex"
        />
      </div>
    </div>
  );
}

function SessionRow({
  src,
  title,
  meta,
  pinned,
}: {
  src: "claude" | "codex" | "gemini";
  title: string;
  meta: string;
  pinned?: boolean;
}) {
  const dimSeparators = (text: string) =>
    text.split(" · ").map((part, i, arr) => (
      <span key={i}>
        {part}
        {i < arr.length - 1 && <span className="dim"> · </span>}
      </span>
    ));
  return (
    <div className="hh-row">
      <span className={`hh-bd hh-bd-${src}`}>{src}</span>
      <div className="bod">
        <div className="ttl">{title}</div>
        <div className="mt">{dimSeparators(meta)}</div>
      </div>
      {pinned ? <PinIcon /> : <span />}
    </div>
  );
}

function InstallPill() {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    void navigator.clipboard.writeText(INSTALL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };
  return (
    <button
      type="button"
      className={`hh-install${copied ? " is-copied" : ""}`}
      onClick={onClick}
      aria-label="Copy install command"
    >
      <span className="tick">$</span>
      <code>{INSTALL_CMD}</code>
      <span className="copy">
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}

/* ─────────────────── Pillar sections (Browse / Pin / Search) ─────────────────── */

function PillarHead({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: React.ReactNode;
  sub: React.ReactNode;
}) {
  return (
    <div className="s-head s-head-edit">
      <div className="s-kick">{kicker}</div>
      <h2 className="s-title">{title}</h2>
      <p className="s-sub">{sub}</p>
    </div>
  );
}

function BrowseSection() {
  return (
    <section className="pillar reveal">
      <PillarHead
        kicker="Browse"
        title={
          <>
            One project, <em>every agent</em>, one view
            <span className="accent">.</span>
          </>
        }
        sub="Spool watches Claude, Codex, Gemini, and OpenCode sessions today. Sessions are grouped by working directory, so opening a project shows everything you discussed there, regardless of which agent you used."
      />

      <div className="pillar-spec">
        <BrowseDiagram />
      </div>
    </section>
  );
}

function BrowseDiagram() {
  return (
    <div className="bd">
      <div className="bd-sources">
        <div className="bd-src">
          <div className="bd-src-head">
            <span className={`hh-bd hh-bd-claude`}>claude</span>
            <span className="bd-src-path">~/.claude/projects/-Users-you-harbor</span>
          </div>
          <div className="bd-src-files">
            <span>0e1f88a2-09b3-4cae-…jsonl</span>
            <span>4c3d12f0-91e8-44b1-…jsonl</span>
            <span>7a55b1ee-2c0f-49b7-…jsonl</span>
            <span className="bd-src-more">+ 39 sessions</span>
          </div>
        </div>

        <div className="bd-src">
          <div className="bd-src-head">
            <span className={`hh-bd hh-bd-codex`}>codex</span>
            <span className="bd-src-path">~/.codex/sessions/2026/05/06/harbor</span>
          </div>
          <div className="bd-src-files">
            <span>rollout-2026-05-06T11-4-…jsonl</span>
            <span>rollout-2026-05-04T09-1-…jsonl</span>
            <span className="bd-src-more">+ 16 sessions</span>
          </div>
        </div>

        <div className="bd-src">
          <div className="bd-src-head">
            <span className={`hh-bd hh-bd-gemini`}>gemini</span>
            <span className="bd-src-path">~/.gemini/tmp/harbor-PROJECT/chats</span>
          </div>
          <div className="bd-src-files">
            <span>chat-2026-05-05.json</span>
            <span>chat-2026-04-22.json</span>
            <span className="bd-src-more">+ 11 sessions</span>
          </div>
        </div>

        <div className="bd-src bd-src-soon">
          <div className="bd-src-head">
            <span className="bd-soon-badge">soon</span>
            <span className="bd-src-path">cursor · windsurf · aider · zed · …</span>
          </div>
        </div>
      </div>

      <div className="bd-arrow" aria-hidden>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
        <span className="bd-arrow-lbl">grouped by working dir</span>
      </div>

      <div className="bd-out">
        <div className="bd-out-head">
          <FolderIcon />
          <span className="bd-out-name">harbor</span>
          <span className="bd-out-meta">142 sessions · 3 agents</span>
        </div>
        <div className="bd-out-stats">
          <div className="bd-out-stat">
            <span className="bd-stat-dot" style={{ background: "var(--src-claude)" }} />
            <span className="bd-stat-num">87</span>
            <span className="bd-stat-lbl">claude</span>
          </div>
          <div className="bd-out-stat">
            <span className="bd-stat-dot" style={{ background: "var(--src-codex)" }} />
            <span className="bd-stat-num">42</span>
            <span className="bd-stat-lbl">codex</span>
          </div>
          <div className="bd-out-stat">
            <span className="bd-stat-dot" style={{ background: "var(--src-gemini)" }} />
            <span className="bd-stat-num">13</span>
            <span className="bd-stat-lbl">gemini</span>
          </div>
        </div>
        <div className="bd-out-foot">All under <code>/Users/you/code/harbor</code></div>
      </div>
    </div>
  );
}

function PinSection() {
  return (
    <section className="pillar reveal">
      <PillarHead
        kicker="Pin"
        title={
          <>
            The ten that <em>matter</em>, on top
            <span className="accent">.</span>
          </>
        }
        sub="One click pins a session in its project — and onto the global Library Home. The ones you keep coming back to stay where you'll find them. No folders, no tags, no ceremony."
      />

      <div className="pillar-spec">
        <PinBoard />
      </div>
    </section>
  );
}

function PinBoard() {
  const pins = [
    {
      rotate: -2.4,
      src: "claude" as const,
      project: "harbor",
      title: "auth middleware: JWT rotation with refresh tokens",
      note: "the canonical rotation discussion — link this anywhere auth comes up",
      date: "Mar 15",
    },
    {
      rotate: 1.6,
      src: "gemini" as const,
      project: "atlas",
      title: "RAG pipeline: llamaindex vs custom orchestration",
      note: "decision tree we worked out before the spike",
      date: "Apr 02",
    },
    {
      rotate: -0.8,
      src: "codex" as const,
      project: "ledger",
      title: "webhook idempotency keys: design + migration plan",
      note: "every part of the design that survived review is here",
      date: "Apr 18",
    },
    {
      rotate: 2.8,
      src: "claude" as const,
      project: "tide",
      title: "B+ tree write path spike — leaf split edge case",
      note: "you'll forget the off-by-one. don't reinvent it.",
      date: "Jan 30",
    },
  ];

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
  );
}

function SearchSection() {
  return (
    <section className="pillar reveal">
      <PillarHead
        kicker="Search"
        title={
          <>
            <span className="kbd-h">⌘K</span> from anywhere — Fast or <em>AI</em>
            <span className="accent">.</span>
          </>
        }
        sub={
          <>
            <strong>Fast</strong> runs FTS5 across every indexed session, instantly.{" "}
            <strong>AI</strong> hands the query to an agent on your machine, which synthesizes an
            answer with sources. The <code>local</code> label never goes away.
          </>
        }
      />

      <div className="pillar-spec">
        <CmdKOverlay />
      </div>
    </section>
  );
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
          <span className="cmdk-q">refresh token rotation</span>
          <span className="cmdk-modes">
            <span className="cmdk-mode on" title="Fast">
              <BoltIcon />
            </span>
            <span className="cmdk-mode" title="AI">
              <SparkleIcon />
            </span>
          </span>
        </div>

        <div className="cmdk-scope">
          <span className="cmdk-scope-lbl">SEARCHING:</span>
          <span className="cmdk-chip">in: project</span>
          <span className="cmdk-chip on">All projects</span>
        </div>

        <div className="cmdk-results">
          <CmdKRow
            src="claude"
            project="harbor"
            title={<>auth middleware: JWT <mark>rotation</mark> with <mark>refresh tokens</mark></>}
            date="today"
          />
          <CmdKRow
            src="claude"
            project="tide"
            title={<><mark>refresh token rotation</mark> edge cases — concurrent requests</>}
            date="2d ago"
          />
          <CmdKRow
            src="codex"
            project="harbor"
            title={<>jwt vs opaque <mark>tokens</mark>: short-lived access + rotating <mark>refresh</mark></>}
            date="5d ago"
          />
          <CmdKRow
            src="gemini"
            project="ledger"
            title={<>session <mark>refresh</mark> with redis TTL spike</>}
            date="Jan 22"
          />
          <CmdKRow
            src="claude"
            project="atlas"
            title={<>webhook idempotency keys: <mark>token</mark> expiry handling</>}
            date="Jan 14"
          />
        </div>

        <div className="cmdk-foot">
          <span className="cmdk-foot-l">View all results ›</span>
          <span className="cmdk-foot-r">
            <span className="cmdk-kbd">↩</span>
            30 results
          </span>
        </div>
      </div>
    </div>
  );
}

function CmdKRow({
  src,
  project,
  title,
  date,
}: {
  src: "claude" | "codex" | "gemini";
  project: string;
  title: React.ReactNode;
  date: string;
}) {
  return (
    <div className="cmdk-row">
      <span className={`hh-bd hh-bd-${src}`}>{src}</span>
      <span className="cmdk-pj">{project}</span>
      <span className="cmdk-ttl">{title}</span>
      <span className="cmdk-date">{date}</span>
    </div>
  );
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14.5 2 3 14h7l-1.5 8L21 10h-7l.5-8z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5L3.5 11l6.5-2 2-6.5z" />
    </svg>
  );
}

/* ───────────────────────── Generic specimen window ───────────────────────── */

function SpecimenWindow({
  title,
  children,
  dim,
}: {
  title: string;
  children: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <div className={`spec-win${dim ? " is-dim" : ""}`}>
      <div className="spec-tb">
        <span className="spec-traffic">
          <span className="r" />
          <span className="y" />
          <span className="g" />
        </span>
        <span className="spec-title">{title}</span>
        <span />
      </div>
      <div className="spec-body">{children}</div>
    </div>
  );
}

function PSRow({
  src,
  title,
  meta,
  pinned,
}: {
  src: "claude" | "codex" | "gemini";
  title: string;
  meta: string;
  pinned?: boolean;
}) {
  return (
    <div className="ps-row">
      <span className={`hh-bd hh-bd-${src}`}>{src}</span>
      <div className="bod">
        <div className="ttl">{title}</div>
        <div className="mt">{meta}</div>
      </div>
      {pinned ? <PinIcon /> : <span />}
    </div>
  );
}

/* ─────────────────────────── Agent integration ─────────────────────────── */

function AgentSection() {
  return (
    <section className="agent-sec reveal">
      <PillarHead
        kicker="Agents"
        title={
          <>
            Your agent reads your <em>library</em> too
            <span className="accent">.</span>
          </>
        }
        sub={
          <>
            Drop the <code>/spool</code> skill into Claude Code and ask things like
            "build on the auth-middleware discussion from last week." It shells out to{" "}
            <code>spool search</code>, returns matching fragments, and lets the agent load any
            session in full. Any tool-using agent can do the same via the CLI.
          </>
        }
      />

      <div className="agent">
        <div className="notes">
          <div>
            <h3>01 — Ask what it ought to know.</h3>
            <p>
              "Build on the auth-middleware discussion from last week." Claude invokes{" "}
              <code>/spool</code>, the skill runs <code>spool search</code> against your local
              index, and matching fragments flow back into the conversation.
            </p>
          </div>
          <div>
            <h3>02 — Sources don't decide retrievability.</h3>
            <p>
              A Claude session, an old Codex run, a Gemini brainstorm — all indexed under the same
              project, all returned by the same search. Whichever agent later asks gets all of it.
            </p>
          </div>
          <div>
            <h3>03 — The CLI is the public surface.</h3>
            <p>
              The skill is a thin wrapper around <code>spool search --json</code>. Any tool-using
              agent — or any script — can talk to your library the same way. Local in, local out.
            </p>
          </div>
        </div>

        <div className="term">
          <div className="line">
            <span className="p">$</span> <span className="you">claude</span>
          </div>
          <div className="line" style={{ marginTop: 10 }}>
            <span className="sys">&gt;</span> <span>build on the auth middleware</span>
          </div>
          <div className="line">
            <span className="sys">&gt;</span> <span>discussion from last week</span>
          </div>

          <div className="out">
            <div className="line">
              <span className="sys">◉</span>{" "}
              <span className="sys">/spool — searching your library…</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: "color-mix(in srgb, var(--src-claude) 20%, transparent)",
                  color: "var(--src-claude)",
                }}
              >
                claude
              </span>
              <span className="path">auth-middleware-rewrite</span>
              <span className="when">Mar 15</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: "color-mix(in srgb, var(--src-codex) 20%, transparent)",
                  color: "var(--src-codex)",
                }}
              >
                codex
              </span>
              <span className="path">jwt rotation spike</span>
              <span className="when">Feb 08</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: "color-mix(in srgb, var(--src-gemini) 20%, transparent)",
                  color: "var(--src-gemini)",
                }}
              >
                gemini
              </span>
              <span className="path">redis session ttl</span>
              <span className="when">Jan 22</span>
            </div>
          </div>

          <div className="inject">→ 3 fragments loaded into context · local</div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────── Principles ──────────────────────────── */

function PrinciplesSection() {
  const principles = [
    {
      n: "i.",
      title: "Library, not search box.",
      body: "The shell is the home — sidebar of projects, main pane of sessions. ⌘K is one entry point among several, not the whole product.",
    },
    {
      n: "ii.",
      title: "Local, always.",
      body: "On-device index, on-device queries, on-device inference. Your machine is the only place your sessions ever live.",
    },
    {
      n: "iii.",
      title: "First-person metadata.",
      body: "\"You discussed this · Mar 15\" beats \"Claude Code · Mar 15.\" The library is yours; the language should say so.",
    },
    {
      n: "iv.",
      title: "Agents read it too.",
      body: "Anything humans can browse, an agent can query. The /spool skill ships with the repo; the same JSON CLI is your public surface.",
    },
  ];
  return (
    <section className="reveal">
      <PillarHead
        kicker="House rules"
        title={
          <>
            Four things we won't <em>compromise</em>
            <span className="accent">.</span>
          </>
        }
        sub="Spool's defaults aren't accidents. These are the four lines we won't cross."
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
  );
}

/* ──────────────────────────── Final CTA ──────────────────────────── */

function FinalCTA() {
  return (
    <section className="final reveal">
      <div className="big">
        Your sessions,
        <br />
        <em>finally findable</em>
        <span className="accent">.</span>
      </div>
      <div className="row">
        <InstallPill />
        <a href="https://github.com/spool-lab/spool" className="hh-btn hh-btn-p">
          <GhIcon />
          Star on GitHub
        </a>
        <a href="/docs/installation" className="hh-btn hh-btn-g">
          Read the docs →
        </a>
      </div>
      <div className="plat">macOS · Apple Silicon · MIT · Built in the open</div>
    </section>
  );
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
  );
}

const TYPED_QUERIES = [
  "refresh token rotation",
  "the gemini RAG session",
  "what did I ship last week",
  "redis ttl edge cases",
  "auth middleware rewrite",
];

function TypedQuery() {
  const [text, setText] = useState(TYPED_QUERIES[0]!);
  const stateRef = useRef({ phrase: 0, char: TYPED_QUERIES[0]!.length, deleting: false, pause: 90 });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = stateRef.current;
      const phrase = TYPED_QUERIES[s.phrase]!;
      if (s.pause > 0) {
        s.pause--;
        timer = setTimeout(tick, 30);
        return;
      }
      if (!s.deleting) {
        setText(phrase.substring(0, s.char + 1));
        s.char++;
        if (s.char === phrase.length) {
          s.deleting = true;
          s.pause = 80;
        }
      } else {
        setText(phrase.substring(0, s.char - 1));
        s.char--;
        if (s.char === 0) {
          s.deleting = false;
          s.phrase = (s.phrase + 1) % TYPED_QUERIES.length;
          s.pause = 18;
        }
      }
      timer = setTimeout(tick, s.deleting ? 28 : 60 + Math.random() * 40);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      {text}
      <span className="caret" />
    </>
  );
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
  );
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
      style={dashed ? { strokeDasharray: "2 2", opacity: 0.6 } : undefined}
    >
      <path d="M1 3.5a1 1 0 0 1 1-1h3l1.5 1.5h5.5a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3.5z" />
    </svg>
  );
}

function GhIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}
