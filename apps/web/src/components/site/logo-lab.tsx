/* Dev-only exploration page: candidate Spool marks (a thread winding
 * diagonally around a cylinder), shown at real sizes on both themes and
 * inside a mock header. Not linked from navigation — visit /logo-lab. */
import { SpoolMark } from './spool-mark'

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
} as const

function MarkA({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} {...STROKE}>
      <ellipse cx="16" cy="8" rx="11" ry="4" />
      <line x1="5" y1="8" x2="5" y2="24" />
      <line x1="27" y1="8" x2="27" y2="24" />
      <path d="M5 24 C5 26.7 10 28.4 16 28.4 C22 28.4 27 26.7 27 24" />
      <path d="M5 12.6 C12 16.6 20 16.2 27 15" />
      <path d="M5 16.8 C12 20.8 20 20.4 27 19.2" />
      <path d="M5 21 C12 25 20 24.6 27 23.4" />
    </svg>
  )
}

function MarkB({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} {...STROKE} strokeWidth={1.9}>
      <ellipse cx="16" cy="7.5" rx="10.5" ry="3.8" />
      <path d="M5.5 11.2 C9 15.4 23 13.2 26.5 16.4" />
      <path d="M5.5 15.6 C9 19.8 23 17.6 26.5 20.8" />
      <path d="M5.5 20 C9 24.2 23 22 26.5 25.2" />
      <path d="M26.5 25.2 C27.5 27.2 28.6 28.2 30.5 28.8" />
    </svg>
  )
}

function MarkC({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} {...STROKE}>
      <ellipse cx="16" cy="8" rx="11" ry="4" />
      <line x1="5" y1="8" x2="5" y2="24" />
      <line x1="27" y1="8" x2="27" y2="24" />
      <path d="M5 24 C5 26.7 10 28.4 16 28.4 C22 28.4 27 26.7 27 24" />
      <path d="M5 13 C12 17 20 16.6 27 15.4" />
      <path d="M27 15.4 C20 13.4 12 13.8 5 17.2" opacity="0.32" strokeWidth={1.3} />
      <path d="M5 17.2 C12 21.2 20 20.8 27 19.6" />
      <path d="M27 19.6 C20 17.6 12 18 5 21.4" opacity="0.32" strokeWidth={1.3} />
      <path d="M5 21.4 C12 25.4 20 25 27 23.8" />
    </svg>
  )
}

/* The mark currently shipping in the site header, for reference. */
function MarkCurrent({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor">
      <ellipse cx="16" cy="9" rx="12" ry="4.5" strokeWidth="1.8" />
      <line x1="4" y1="9" x2="4" y2="22" strokeWidth="1.8" />
      <line x1="28" y1="9" x2="28" y2="22" strokeWidth="1.8" />
      <path d="M4 22 C4 24.5 9 27 16 27 C23 27 28 24.5 28 22" strokeWidth="1.8" />
      <ellipse cx="16" cy="11" rx="7" ry="2.5" strokeWidth="1.2" />
      <line x1="9" y1="11" x2="9" y2="20" strokeWidth="1.2" />
      <line x1="23" y1="11" x2="23" y2="20" strokeWidth="1.2" />
      <path d="M9 20 C9 21.5 12 23 16 23 C20 23 23 21.5 23 20" strokeWidth="1.2" />
      <ellipse cx="16" cy="11" rx="3" ry="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

const VARIANTS: ReadonlyArray<{
  key: string
  name: string
  note: string
  Mark: (props: { size: number }) => React.ReactNode
}> = [
  { key: 'current', name: '现状 · 参考', note: '当前线上的 SpoolMark', Mark: MarkCurrent },
  {
    key: 'a',
    name: 'A · 完整圆柱 + 斜绕线',
    note: '圆柱轮廓完整，三道斜绕线；最稳健',
    Mark: MarkA,
  },
  {
    key: 'b',
    name: 'B · 纯线圈',
    note: '绕线即形体，右下线头飞出；剪影最独特',
    Mark: MarkB,
  },
  {
    key: 'c',
    name: 'C · 立体绕线',
    note: 'A + 背面暗线；大尺寸立体感最强',
    Mark: MarkC,
  },
  {
    key: 'd',
    name: 'D · 实心顶盖',
    note: '实心盘锚定 + 绕线 + 线头；已按「盖宽于线圈」调优（现役方案）',
    Mark: ({ size }: { size: number }) => <SpoolMark size={size} />,
  },
]

const THEMES = [
  { key: 'dark', bg: '#000000', fg: '#ffffff', border: '#1f1f1f', accent: '#5bb1f0' },
  { key: 'light', bg: '#ffffff', fg: '#0a0a0a', border: '#e5e5e5', accent: '#1387ff' },
] as const

export default function LogoLab() {
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '48px 20px 96px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
        Spool mark — 候选方案
      </h1>
      <p style={{ color: 'var(--color-muted)', margin: '8px 0 40px', fontSize: 14 }}>
        一条线斜着一圈圈绕着圆柱。每个方案给出 96 / 48 / 24 / 16px、字标组合、以及页头实境预览。
      </p>

      {VARIANTS.map((v) => (
        <section key={v.key} style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>{v.name}</h2>
          <p style={{ color: 'var(--color-muted)', fontSize: 13, margin: '0 0 16px' }}>{v.note}</p>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {THEMES.map((t) => (
              <div
                key={t.key}
                style={{
                  flex: '1 1 420px',
                  background: t.bg,
                  color: t.fg,
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 18,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
                  <v.Mark size={96} />
                  <v.Mark size={48} />
                  <v.Mark size={24} />
                  <v.Mark size={16} />
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    fontWeight: 700,
                    fontSize: 19,
                    letterSpacing: '-0.04em',
                  }}
                >
                  <v.Mark size={22} />
                  <span>
                    Spool<span style={{ color: t.accent }}>.</span>
                  </span>
                </div>

                {/* Mock header in context */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop: `1px solid ${t.border}`,
                    paddingTop: 14,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontWeight: 700,
                      fontSize: 16,
                      letterSpacing: '-0.04em',
                    }}
                  >
                    <v.Mark size={20} />
                    <span>
                      Spool<span style={{ color: t.accent }}>.</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 18, fontSize: 13, opacity: 0.75 }}>
                    <span>Explore</span>
                    <span>Docs</span>
                    <span>Blog</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
