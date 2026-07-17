import type { Template } from '@spool/share-kit'

type Props = {
  id: Template
  accent: string
  paper: string
  border: string
  text: string
  muted: string
  surface: string
}

export function TemplateThumb({ id, accent, paper, border, text, muted, surface }: Props) {
  const baseStyle: React.CSSProperties = {
    width: 48,
    height: 44,
    borderRadius: 2,
    background: paper,
    border: `1px solid ${border}`,
    flexShrink: 0,
    padding: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  }
  const bar = (w: string, op = 1) => (
    <div style={{ height: 2, width: w, background: muted, opacity: op, borderRadius: 1 }} />
  )

  if (id === 'forum') {
    const post = (avatarBg: string, lines: number) => (
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: avatarBg,
            flexShrink: 0,
            marginTop: 0.5,
          }}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {bar('70%', 0.8)}
          {Array.from({ length: lines }).map((_, idx) => bar(idx === lines - 1 ? '60%' : '95%', 0.5))}
        </div>
      </div>
    )
    return (
      <div style={baseStyle}>
        <div style={{ height: 3, width: '55%', background: text }} />
        <div style={{ height: 1, background: border, margin: '1px 0' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {post(surface, 2)}
          <div style={{ height: 1, background: border }} />
          {post(accent, 2)}
        </div>
      </div>
    )
  }
  if (id === 'letter') {
    return (
      <div style={baseStyle}>
        <div style={{ height: 3, width: '60%', background: text }} />
        <div style={{ height: 1.5, width: '18%', background: accent, marginBottom: 1 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {bar('90%', 0.5)}
          {bar('100%', 0.55)}
          {bar('85%', 0.5)}
          {bar('95%', 0.55)}
          {bar('70%', 0.45)}
        </div>
      </div>
    )
  }
  if (id === 'chat') {
    return (
      <div style={baseStyle}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: '55%', height: 5, background: surface, borderRadius: 3 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5, marginTop: 2 }}>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <span style={{ width: 3, height: 3, background: accent, borderRadius: '50%' }} />
            {bar('60%', 0.5)}
          </div>
          {bar('80%', 0.45)}
          {bar('70%', 0.45)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
          <div style={{ width: '40%', height: 5, background: surface, borderRadius: 3 }} />
        </div>
      </div>
    )
  }
  // interview
  return (
    <div style={baseStyle}>
      <div style={{ height: 2.5, width: '55%', background: text }} />
      <div style={{ height: 1.5, width: '18%', background: accent, marginBottom: 1 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <span style={{ fontSize: 5.5, fontWeight: 700, color: accent, lineHeight: 1 }}>Q</span>
          <div style={{ height: 2.5, flex: 1, background: text, opacity: 0.85 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5, paddingLeft: 5 }}>
          {bar('95%', 0.5)}
          {bar('80%', 0.45)}
          {bar('90%', 0.5)}
        </div>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', marginTop: 1 }}>
          <span style={{ fontSize: 5.5, fontWeight: 700, color: accent, lineHeight: 1 }}>Q</span>
          <div style={{ height: 2.5, width: '70%', background: text, opacity: 0.85 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5, paddingLeft: 5 }}>
          {bar('85%', 0.5)}
          {bar('95%', 0.5)}
        </div>
      </div>
    </div>
  )
}
