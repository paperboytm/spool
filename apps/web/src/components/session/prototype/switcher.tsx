// PROTOTYPE — throwaway (see NOTES.md in this directory).
//
// Three variants of the /session/<sid> page, switchable via ?variant=,
// on the existing route. This file owns the URL param plumbing and the
// floating bottom bar. Everything is dead in production builds:
// import.meta.env.DEV gates both the bar and the mock data path.

import { useEffect, useState, type CSSProperties } from 'react'

export const PROTOTYPE_VARIANTS = ['current', 'doc', 'bench', 'cover'] as const
export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number]

const VARIANT_NAMES: Record<PrototypeVariant, string> = {
  current: 'Current dossier',
  doc: 'Document',
  bench: 'Workbench',
  cover: 'Cover card',
}

function variantFromUrl(): PrototypeVariant {
  const raw = new URLSearchParams(window.location.search).get('variant')
  return (PROTOTYPE_VARIANTS as readonly string[]).includes(raw ?? '')
    ? (raw as PrototypeVariant)
    : 'current'
}

/** `?mock=1` — render the page from the fixture instead of the hub. */
export function prototypeMockRequested(): boolean {
  return new URLSearchParams(window.location.search).get('mock') === '1'
}

export function usePrototypeVariant(): [PrototypeVariant, (v: PrototypeVariant) => void] {
  const [variant, setVariant] = useState<PrototypeVariant>(() =>
    import.meta.env.DEV ? variantFromUrl() : 'current',
  )
  const set = (next: PrototypeVariant) => {
    const url = new URL(window.location.href)
    if (next === 'current') url.searchParams.delete('variant')
    else url.searchParams.set('variant', next)
    // replaceState keeps the in-memory session data — App.tsx computes
    // the route once at mount and the pathname does not change here.
    window.history.replaceState(null, '', url.toString())
    setVariant(next)
  }
  return [variant, set]
}

export function PrototypeSwitcher({
  variant,
  onChange,
}: {
  variant: PrototypeVariant
  onChange: (v: PrototypeVariant) => void
}) {
  const cycle = (delta: number) => {
    const index = PROTOTYPE_VARIANTS.indexOf(variant)
    const next = (index + delta + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length
    onChange(PROTOTYPE_VARIANTS[next] as PrototypeVariant)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      )
        return
      if (event.key === 'ArrowLeft') cycle(-1)
      if (event.key === 'ArrowRight') cycle(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!import.meta.env.DEV) return null

  return (
    <div style={barStyle}>
      <button type="button" style={arrowStyle} onClick={() => cycle(-1)} aria-label="Previous variant">
        ←
      </button>
      <span style={labelStyle}>
        {PROTOTYPE_VARIANTS.indexOf(variant) === 0
          ? ''
          : `${String.fromCharCode(64 + PROTOTYPE_VARIANTS.indexOf(variant))} — `}
        {VARIANT_NAMES[variant]}
      </span>
      <button type="button" style={arrowStyle} onClick={() => cycle(1)} aria-label="Next variant">
        →
      </button>
    </div>
  )
}

// Deliberately NOT part of the design under evaluation: high-contrast
// near-black pill regardless of theme, so it reads as scaffolding.
const barStyle: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: '#101014',
  color: '#F5F5F0',
  border: '1px solid #34343C',
  borderRadius: 9999,
  padding: '6px 10px',
  boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
  fontFamily: "'Geist', system-ui, sans-serif",
  fontSize: 12,
}

const arrowStyle: CSSProperties = {
  background: 'none',
  border: 0,
  color: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
  padding: '2px 8px',
  borderRadius: 9999,
}

const labelStyle: CSSProperties = {
  minWidth: 130,
  textAlign: 'center',
  fontWeight: 500,
  letterSpacing: '0.01em',
}
