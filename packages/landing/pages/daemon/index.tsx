import { useState } from "react";
import registry from "../../data/registry.json";

const INSTALL_CMD = "curl -fsSL https://spool.pro/install-daemon.sh | bash";
const REPO_URL = "https://github.com/spool-lab/spool-daemon";

// ─── Tray cells (hero specimen, 8 cells × 2 cols) ──────────────────────
const TRAY_CELLS = [
  { name: "GitHub Stars", color: "var(--src-github)", meta: "1,214 · synced 2m" },
  { name: "X Bookmarks", color: "var(--src-twitter)", meta: "891 · synced 12m" },
  { name: "Reddit Saved", color: "var(--src-reddit)", meta: "203 · synced 1h" },
  { name: "Hacker News", color: "var(--src-hn)", meta: "76 · synced 8m" },
  { name: "Xiaohongshu", color: "var(--src-xhs)", meta: "42 · synced 1h" },
  { name: "YouTube Likes", color: "var(--src-youtube)", meta: "64 · synced 3h" },
  { name: "Reddit Upvoted", color: "var(--src-reddit)", meta: "418 · synced 1h" },
  { name: "Typeless Voice", color: "#3A3A3A", meta: "128 · live" },
];

const TICKER_DAEMON = [
  { name: "GitHub", color: "var(--src-github)", count: "1.2k" },
  { name: "Twitter / X", color: "var(--src-twitter)", count: "891" },
  { name: "Reddit", color: "var(--src-reddit)", count: "203" },
  { name: "Hacker News", color: "var(--src-hn)", count: "76" },
  { name: "Xiaohongshu", color: "var(--src-xhs)", count: "42" },
  { name: "YouTube", color: "var(--src-youtube)", count: "64" },
];

// ─── Registry → connector cards (rich cards, dedupe by package name) ──
type RegistryEntry = {
  name: string;
  id: string;
  platform: string;
  label: string;
  description: string;
  color: string;
  author: string;
  category: string;
  firstParty: boolean;
  npm?: string;
  packageDescription?: string;
};

type GroupedPackage = {
  name: string;
  label: string;
  color: string;
  category: string;
  author: string;
  description: string;
  packageDescription?: string;
  subs: { label: string; description: string }[];
};

function groupPackages(): GroupedPackage[] {
  const connectors = registry.connectors as RegistryEntry[];
  const map = new Map<string, GroupedPackage>();
  for (const c of connectors) {
    const existing = map.get(c.name);
    if (existing) {
      existing.subs.push({ label: c.label, description: c.description });
      if (c.packageDescription && !existing.packageDescription) {
        existing.packageDescription = c.packageDescription;
      }
    } else {
      map.set(c.name, {
        name: c.name,
        label: c.label,
        color: c.color,
        category: c.category,
        author: c.author,
        description: c.description,
        packageDescription: c.packageDescription,
        subs: [{ label: c.label, description: c.description }],
      });
    }
  }
  for (const pkg of map.values()) {
    if (pkg.subs.length > 1) {
      const words = pkg.subs[0]!.label.split(" ");
      const common = words.filter((w) => pkg.subs.every((s) => s.label.includes(w)));
      pkg.label = common.length > 0 ? common.join(" ") : pkg.subs[0]!.label.split(" ")[0]!;
    }
  }
  return [...map.values()];
}

function initialOf(label: string): string {
  const cleaned = label.replace(/^[^A-Za-z0-9一-龥]+/, "");
  return cleaned.charAt(0).toUpperCase() || "·";
}

// ─── Shortened SDK example (skeleton, not full impl) ──────────────────
const PACKAGE_JSON_EXAMPLE = `{
  "name": "@spool-lab/connector-hackernews-hot",
  "version": "0.1.2",
  "type": "module",
  "main": "./dist/index.js",
  "dependencies": {
    "@spool-lab/connector-sdk": "^0.1.0"
  },
  "spool": {
    "type": "connector",
    "id": "hackernews-hot",
    "platform": "hackernews",
    "label": "Hacker News Hot",
    "color": "#FF6600",
    "ephemeral": true,
    "capabilities": ["fetch", "log"]
  }
}`;

const SDK_EXAMPLE = `import type {
  Connector, ConnectorCapabilities, AuthStatus,
  PageResult, FetchContext,
} from "@spool-lab/connector-sdk";

export default class HackerNewsHot implements Connector {
  readonly id = "hackernews-hot";
  readonly platform = "hackernews";
  readonly label = "Hacker News Hot";
  readonly color = "#FF6600";
  readonly ephemeral = true;

  constructor(private readonly caps: ConnectorCapabilities) {}

  async checkAuth(): Promise<AuthStatus> {
    return { ok: true };
  }

  async fetchPage(ctx: FetchContext): Promise<PageResult> {
    const items = await fetchTopStories(this.caps, ctx);
    return { items, nextCursor: null };
  }
}`;

const KEYWORDS = new Set([
  "import", "from", "type", "export", "default", "class", "implements",
  "readonly", "constructor", "private", "async", "await", "return",
  "const", "let", "of", "as", "new", "this",
]);

function tokenize(line: string): { text: string; cls?: string }[] {
  const out: { text: string; cls?: string }[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const cm = rest.match(/^\/\/[^\n]*/);
    if (cm) { out.push({ text: cm[0], cls: "tok-cm" }); i += cm[0].length; continue; }
    const s = rest.match(/^"[^"]*"|^'[^']*'|^`[^`]*`/);
    if (s) { out.push({ text: s[0], cls: "tok-str" }); i += s[0].length; continue; }
    const w = rest.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (w) {
      const word = w[0];
      out.push({ text: word, cls: KEYWORDS.has(word) ? "tok-kw" : undefined });
      i += word.length;
      continue;
    }
    out.push({ text: rest[0]! });
    i++;
  }
  return out;
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="code-block">
      {code.split("\n").map((line, idx) => (
        <div className="code-line" key={idx}>
          <span className="ln">{idx + 1}</span>
          <span>
            {tokenize(line).map((t, j) =>
              t.cls ? <span key={j} className={t.cls}>{t.text}</span> : <span key={j}>{t.text}</span>,
            )}
          </span>
        </div>
      ))}
    </pre>
  );
}

function InstallPill({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };
  return (
    <button
      type="button"
      className={`install${copied ? " copied" : ""}`}
      onClick={onClick}
      aria-label="Copy install command"
    >
      <span className="tick">$</span>
      <code>{cmd}</code>
      <span className="copy">
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}

function CopyCliBtn({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };
  return (
    <button
      type="button"
      className={`c-copy-btn${copied ? " copied" : ""}`}
      onClick={onClick}
      aria-label="Copy install command"
      title={copied ? "Copied!" : "Copy install command"}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-6.5" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5" y="5" width="8" height="8" rx="1.5" />
          <path d="M3 11V4a1 1 0 0 1 1-1h7" />
        </svg>
      )}
      <span>{copied ? "Copied" : "Copy CLI"}</span>
    </button>
  );
}

function GhIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// ─── DaemonTray (right-side hero specimen) ──────────────────────────────
const RECENT_ACTIVITY = [
  { kind: "↻", text: "GitHub Stars", meta: "+14 captures · 2m ago" },
  { kind: "↻", text: "X Bookmarks", meta: "+3 bookmarks · 12m ago" },
  { kind: "↻", text: "Hacker News Hot", meta: "+22 stories · 8m ago" },
  { kind: "✓", text: "Reddit Saved", meta: "no changes · 1h ago" },
];

function DaemonTray() {
  return (
    <div className="tray">
      <div className="t-top">
        <div className="t-title"><span className="dot" />Spool Daemon · running</div>
        <div className="t-status">{TRAY_CELLS.length} connectors · next sync 4m</div>
      </div>
      <div className="t-grid">
        {TRAY_CELLS.map((c) => (
          <div className="t-cell" key={c.name}>
            <div className="n"><span className="sw" style={{ background: c.color }} />{c.name}</div>
            <div className="m">{c.meta}</div>
          </div>
        ))}
      </div>
      <div className="t-activity">
        <div className="t-act-head">RECENT</div>
        {RECENT_ACTIVITY.map((a, i) => (
          <div className="t-act" key={i}>
            <span className={`t-act-kind${a.kind === "✓" ? " ok" : ""}`}>{a.kind}</span>
            <span className="t-act-name">{a.text}</span>
            <span className="t-act-meta">{a.meta}</span>
          </div>
        ))}
      </div>
      <div className="t-foot">
        <span>2,490 items · SQLite FTS5 · local</span>
        <span className="sync">● syncing</span>
      </div>
    </div>
  );
}

// ─── Ticker (daemon mode) ────────────────────────────────────────────────
function DaemonTicker() {
  const items = [...TICKER_DAEMON, ...TICKER_DAEMON, ...TICKER_DAEMON];
  return (
    <div className="ticker">
      <span className="label">· Captures, synced</span>
      <div className="ticker-track">
        {items.map((item, i) => (
          <span className="ticker-item" key={i}>
            <span className="ico">
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, display: "inline-block" }} />
            </span>
            {item.name}
            <span className="count">{item.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Lifecycle (install → sync → search) ────────────────────────────────
const LIFECYCLE = [
  {
    n: "i.",
    title: "Install plugins.",
    body: (
      <>
        Pick connectors from the registry — install via{" "}
        <code>spool-daemon install</code>, click an{" "}
        <code>spool-daemon://</code> deep-link, or the in-app picker.
      </>
    ),
    glyph: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="8" y="6" width="32" height="24" rx="3" />
        <path d="M16 18l8 8 8-8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M24 6v20" strokeLinecap="round" />
        <rect x="6" y="34" width="36" height="8" rx="2" />
        <circle cx="13" cy="38" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    n: "ii.",
    title: "Sync on cadence.",
    body: (
      <>
        Each connector declares its own schedule — hourly, daily, watched. The
        daemon respects rate limits, backs off on failure and resumes on next
        wake. Your laptop stays quiet.
      </>
    ),
    glyph: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.3">
        <circle cx="24" cy="24" r="16" />
        <path d="M24 12v12l8 5" strokeLinecap="round" />
        <path d="M8 14l4-2M40 14l-4-2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    n: "iii.",
    title: "Search locally.",
    body: (
      <>
        Spotlight-style search in the app, or{" "}
        <code>spool-daemon search "…"</code> from the CLI. Full-text across
        everything that's been synced.
      </>
    ),
    glyph: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.3">
        <circle cx="22" cy="22" r="12" />
        <path d="M31 31l9 9" strokeLinecap="round" />
        <path d="M16 22h12M22 16v12" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
];

// ─── Principles (reflects actual daemon design) ─────────────────────────
const PRINCIPLES = [
  {
    n: "i.",
    title: "Local, always.",
    body: (
      <>
        One SQLite file at <code>~/.spool-daemon/spool-daemon.db</code>. No
        cloud sync, no analytics, no profile. Inspect it with{" "}
        <code>sqlite3</code> any time.
      </>
    ),
  },
  {
    n: "ii.",
    title: "Plugins are npm packages.",
    body: (
      <>
        Every connector ships on npm as{" "}
        <code>@spool-lab/connector-*</code> (or your own scope). Read the
        source, fork it, publish your own.
      </>
    ),
  },
  {
    n: "iii.",
    title: "CLI and app, equal.",
    body: (
      <>
        Search, list, show, install, sync — every action works from{" "}
        <code>spool-daemon</code> on the terminal or from the app. Pick
        whichever fits the moment.
      </>
    ),
  },
  {
    n: "iv.",
    title: "Standalone or paired.",
    body: (
      <>
        Spool Daemon runs alone — you don't need Spool to use it. Pair with
        Spool to make captures and sessions searchable from one box.
      </>
    ),
  },
];

export default function DaemonPage() {
  const packages = groupPackages();
  return (
    <>
      <main className="wrap">
        <div className="hero hero-daemon">
          <div>
            <div className="eyebrow">
              <span className="pulse" /> v0.1 · standalone app · macOS + Linux
            </div>
            <h1 className="display">
              Background sync
              <br />
              for your
              <br />
              <em>captures<span className="accent">.</span></em>
            </h1>
            <p className="lede">
              Spool Daemon is a standalone app that quietly pulls your stars,
              bookmarks, saves and notes into a local SQLite database — searchable
              from its own UI, or paired with Spool. Plugins for the platforms
              you care about. Nothing leaves the machine.
            </p>
            <div className="cta-row tight">
              <InstallPill cmd={INSTALL_CMD} />
              <a href={REPO_URL} className="btn primary"><GhIcon />&nbsp;Star on GitHub</a>
            </div>
            <div className="meta-row">
              <span>MIT</span><span className="dotsep" />
              <span>macOS · Apple Silicon</span><span className="dotsep" />
              <span>Linux · x86_64</span><span className="dotsep" />
              <a href="/" style={{ color: "var(--muted)", borderBottom: "1px dotted var(--border2)" }}>Spool →</a>
            </div>
          </div>
          <DaemonTray />
        </div>
      </main>

      <DaemonTicker />

      <main className="wrap">
        {/* 01 · CONNECTORS — rich card grid (registry-driven) */}
        <section className="sect" id="connectors">
          <div className="s-head">
            <div className="s-num"><span className="line" />01 · CONNECTORS</div>
            <div>
              <h2 className="s-title">
                One connector per <em>platform</em><span className="accent">.</span>
              </h2>
              <p className="s-sub">
                Each connector is a small npm package. Install from the CLI or
                click <code>Install</code> to launch directly into Spool Daemon.
              </p>
            </div>
          </div>
          <div className="connector-grid">
            {packages.map((pkg) => {
              const sourceCount = pkg.subs.length;
              const desc =
                sourceCount > 1 ? (pkg.packageDescription ?? pkg.description) : pkg.description;
              const cliCmd = `spool-daemon install ${pkg.name}`;
              return (
                <div className="c-card" key={pkg.name}>
                  <div className="c-head">
                    <span className="c-icon" style={{ background: pkg.color }}>
                      {initialOf(pkg.label)}
                    </span>
                    <div className="c-headtext">
                      <div className="c-title">{pkg.label}</div>
                      <div className="c-author">
                        {pkg.author === "spool-lab" ? "Spool Lab" : pkg.author}
                      </div>
                    </div>
                  </div>
                  <p className="c-desc">{desc}</p>
                  <div className="c-foot">
                    <span className="c-meta">
                      <span className="category">{pkg.category}</span>
                      <span className="sep">·</span>
                      <span>{sourceCount} {sourceCount === 1 ? "source" : "sources"}</span>
                    </span>
                    <span className="c-actions">
                      <CopyCliBtn cmd={cliCmd} />
                      <a
                        href={`spool-daemon://connector/install/${pkg.name}`}
                        className="c-install-btn"
                      >
                        Install
                      </a>
                    </span>
                  </div>
                </div>
              );
            })}
            <a
              href="#plugins"
              className="c-card c-ghost"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("plugins")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <div className="c-head">
                <span className="c-icon c-icon-ghost" aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </span>
                <div className="c-headtext">
                  <div className="c-title">Write your own</div>
                  <div className="c-author">@spool-lab/connector-sdk</div>
                </div>
              </div>
              <p className="c-desc">
                Implement the <code>Connector</code> interface, publish to npm, install
                from anywhere. Daemon handles scheduling, retries and dedupe.
              </p>
              <div className="c-foot">
                <span className="c-meta">
                  <span className="category">SDK</span>
                  <span className="sep">·</span>
                  <span>~50 lines</span>
                </span>
                <span className="c-actions">
                  <span className="c-ghost-cta">See the skeleton ↓</span>
                </span>
              </div>
            </a>
          </div>
        </section>

        {/* 02 · LIFECYCLE */}
        <section className="sect">
          <div className="s-head">
            <div className="s-num"><span className="line" />02 · LIFECYCLE</div>
            <div>
              <h2 className="s-title">
                How the daemon <em>works</em><span className="accent">.</span>
              </h2>
              <p className="s-sub">
                Three things, in order. Pick connectors, let them sync, search the
                local index — from the app, from the CLI, or both.
              </p>
            </div>
          </div>
          <div className="lifecycle">
            {LIFECYCLE.map((l) => (
              <div className="lc-card" key={l.n}>
                <div className="lc-glyph">{l.glyph}</div>
                <div className="lc-n">{l.n}</div>
                <h4 className="lc-title">{l.title}</h4>
                <p className="lc-body">{l.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 03 · PLUGINS */}
        <section className="sect" id="plugins">
          <div className="s-head">
            <div className="s-num"><span className="line" />03 · PLUGINS</div>
            <div>
              <h2 className="s-title">
                Write your own <em>connector</em><span className="accent">.</span>
              </h2>
              <p className="s-sub">
                Implement the <code style={{ fontFamily: "'Geist Mono'", fontSize: 13, background: "var(--accent-weak)", color: "var(--accent)", padding: "2px 6px", borderRadius: 4 }}>Connector</code>{" "}
                interface and publish to npm. The daemon handles scheduling, retries,
                rate-limit backoff, dedupe and writes to the local index.
              </p>
            </div>
          </div>
          <div className="plugin-grid">
            <div className="plugin-prose plugin-prose-1">
              <div className="ps-kicker">Skeleton — the Connector class</div>
              <p>
                A class with a few readonly fields, <code>checkAuth()</code> and{" "}
                <code>fetchPage()</code>. <code>caps.fetch</code> is the daemon's
                managed fetch (handles abort, system proxies, logging). Items
                emitted as <code>CapturedItem[]</code> get written to the local
                FTS5 index — no schema work for you.
              </p>
            </div>
            <div className="plugin-prose plugin-prose-2">
              <div className="ps-kicker">Discovery — the package.json</div>
              <p>
                The daemon finds your connector through the{" "}
                <code>"spool"</code> block in <code>package.json</code> — id,
                platform, label, color, capabilities. Publish to npm and anyone
                can <code>spool-daemon install</code> it. To show up in the
                public directory, send a PR to{" "}
                <code>spool-lab/spool-daemon</code> with one entry.
              </p>
            </div>
            <div className="plugin-code plugin-code-1">
              <div className="code-head">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
                <span className="filename">connectors/hackernews-hot/src/index.ts</span>
              </div>
              <CodeBlock code={SDK_EXAMPLE} />
            </div>
            <div className="plugin-code plugin-code-2">
              <div className="code-head">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
                <span className="filename">package.json</span>
              </div>
              <CodeBlock code={PACKAGE_JSON_EXAMPLE} />
            </div>
            <div className="ps-cta">
              <a href={`${REPO_URL}/blob/main/docs/connector-developer-guide.md`} className="btn">
                Read the SDK guide →
              </a>
              <a href={`${REPO_URL}/tree/main/packages/connectors`} className="btn ghost">
                Built-in connectors
              </a>
            </div>
          </div>
        </section>

        {/* 04 · PRINCIPLES */}
        <section className="sect">
          <div className="s-head">
            <div className="s-num"><span className="line" />04 · PRINCIPLES</div>
            <div>
              <h2 className="s-title">Rules of the <em>house</em><span className="accent">.</span></h2>
            </div>
          </div>
          <div className="principles">
            {PRINCIPLES.map((p) => (
              <div className="principle" key={p.n}>
                <div className="p-num">{p.n}</div>
                <h4>{p.title}</h4>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="sect final" style={{ borderBottom: "none" }}>
          <div className="big">
            Captures, quietly
            <br />
            <em>indexed</em><span className="accent">.</span>
          </div>
          <div className="row">
            <InstallPill cmd={INSTALL_CMD} />
            <a href={REPO_URL} className="btn primary"><GhIcon />&nbsp;Star on GitHub</a>
            <a href={`${REPO_URL}#readme`} className="btn">Read the docs →</a>
          </div>
          <div className="plat">macOS · Apple Silicon · Linux x86_64 · MIT · Built in the open</div>
        </section>
      </main>
    </>
  );
}
