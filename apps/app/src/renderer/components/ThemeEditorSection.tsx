import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThemeEditorStateV1, ThemeSideConfig } from '../theme/editorTypes.js'
import { THEME_PRESETS } from '../theme/editorTypes.js'
import { lightPresetSeed, darkPresetSeed } from '../theme/presetSeeds.js'
import { parseHex, toHex, adaptiveCardTone, hexToRgba, mixHex } from '../theme/colorUtils.js'
import SegmentedPill from './SegmentedPill.js'
import Menu from './Menu.js'

function colorInputValue(hex: string): string {
  const parsed = parseHex(hex)
  return parsed ? toHex(parsed) : '#888888'
}

const sideInputBase =
  'rounded-[6px] border outline-none transition-colors focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-[var(--side-accent)]'

function tintForValue(hex: string) {
  const tone = adaptiveCardTone(hex)
  return {
    backgroundColor: hex,
    borderColor: hexToRgba(tone.isLight ? '#000000' : '#FFFFFF', 0.16),
    color: tone.primary,
  }
}

function ColorRow(props: {
  id: string
  label: string
  value: string
  tone: ReturnType<typeof adaptiveCardTone>
  fieldBg: string
  divider: string
  onChange: (next: string) => void
  /** Match outer card border — divide-y ignores parent borderColor (not inherited). */
  showTopRule?: boolean
  ruleColor: string
}) {
  const { t } = useTranslation()
  const { id, label, value, tone, fieldBg, divider, onChange, showTopRule, ruleColor } = props
  const swatch = tintForValue(colorInputValue(value))

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${showTopRule ? 'border-t border-solid' : ''}`}
      style={showTopRule ? { borderTopColor: ruleColor } : undefined}
    >
      <div className="relative h-7 w-7 flex-none">
        <input
          id={`${id}-picker`}
          name={`${id}-picker`}
          type="color"
          value={colorInputValue(value)}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={t('themeEditor.accent_color_aria', { label })}
        />
        <div className="h-full w-full rounded-full border shadow-sm" style={swatch} />
      </div>
      <label
        htmlFor={`${id}-hex`}
        className="flex-1 min-w-0 text-[12px] font-medium"
        style={{ color: tone.primary }}
      >
        {label}
      </label>
      <input
        id={`${id}-hex`}
        name={`${id}-hex`}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        className={`h-7 w-[112px] text-right px-2 font-mono text-[11px] tabular-nums ${sideInputBase}`}
        style={{ backgroundColor: fieldBg, borderColor: divider, color: tone.primary }}
        aria-label={t('themeEditor.accent_hex_aria', { label })}
      />
    </div>
  )
}

function SideBlock(props: {
  title: string
  mode: 'light' | 'dark'
  slot: ThemeSideConfig
  onSlotChange: (next: ThemeSideConfig) => void
}) {
  const { t } = useTranslation()
  const { title, mode, slot, onSlotChange } = props

  const patch = (partial: Partial<ThemeSideConfig>) => {
    const next = { ...slot, ...partial }
    if (partial.accent != null || partial.background != null || partial.foreground != null) {
      if (next.preset !== 'custom') next.preset = 'custom'
    }
    onSlotChange(next)
  }

  const onPreset = (value: string) => {
    if (value === 'custom') {
      onSlotChange({ ...slot, preset: 'custom' })
      return
    }
    if (mode === 'light') {
      if (value === 'spool') onSlotChange(lightPresetSeed('spool', slot))
      else if (value === 'solarized') onSlotChange(lightPresetSeed('solarized', slot))
      else if (value === 'everforest') onSlotChange(lightPresetSeed('everforest', slot))
    } else {
      if (value === 'spool') onSlotChange(darkPresetSeed('spool', slot))
      else if (value === 'solarized') onSlotChange(darkPresetSeed('solarized', slot))
      else if (value === 'everforest') onSlotChange(darkPresetSeed('everforest', slot))
    }
  }

  const normalizedPreset = slot.preset === 'forest' ? 'everforest' : slot.preset
  const presetValue =
    THEME_PRESETS.includes(normalizedPreset as (typeof THEME_PRESETS)[number])
      ? normalizedPreset
      : 'custom'

  const tone = adaptiveCardTone(slot.background)
  const prefix = `theme-${mode}`
  const surface = mixHex(slot.background, slot.foreground, mode === 'light' ? 0.035 : 0.05)
  /**
   * Card outline + internal rules: same mix as DESIGN.md dividers (subtle fg on bg),
   * not Tailwind defaults (divide-y would ignore parent inline borderColor).
   */
  const divider = mixHex(slot.background, slot.foreground, mode === 'light' ? 0.1 : 0.11)
  const fieldBg = mixHex(slot.background, slot.foreground, mode === 'light' ? 0.06 : 0.12)

  return (
    <section
      className="mb-4 overflow-hidden rounded-[10px] border"
      style={{
        ['--side-accent' as string]: slot.accent,
        borderColor: divider,
        backgroundColor: slot.background,
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
        style={{
          borderColor: divider,
          backgroundColor: surface,
        }}
      >
        <div className="min-w-0">
          <h4 className="text-xs font-semibold" style={{ color: tone.primary }}>{title}</h4>
        </div>
        <div className="flex justify-end min-w-[168px]">
          <Menu
            align="right"
            items={[
              { value: 'spool', label: t('themeEditor.preset_spool') },
              { value: 'solarized', label: t('themeEditor.preset_solarized') },
              { value: 'everforest', label: t('themeEditor.preset_everforest') },
              { value: 'custom', label: t('themeEditor.preset_custom') },
            ].map(o => ({
              label: o.label,
              active: o.value === presetValue,
              onSelect: () => onPreset(o.value),
            }))}
            trigger={({ open, toggle }) => {
              const currentLabel = (() => {
                switch (presetValue) {
                  case 'spool': return t('themeEditor.preset_spool')
                  case 'solarized': return t('themeEditor.preset_solarized')
                  case 'everforest': return t('themeEditor.preset_everforest')
                  default: return t('themeEditor.preset_custom')
                }
              })()
              return (
                <button
                  type="button"
                  id={`${prefix}-preset`}
                  aria-haspopup="listbox"
                  aria-expanded={open}
                  aria-label={t('themeEditor.presetAria', { title })}
                  onClick={toggle}
                  className={`inline-flex min-w-[120px] items-center gap-2 h-8 rounded-[6px] border pl-3 pr-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-[var(--side-accent)]`}
                  style={{
                    backgroundColor: fieldBg,
                    borderColor: open ? slot.accent : divider,
                    color: tone.primary,
                  }}
                >
                  <span className="flex-1 text-left truncate">{currentLabel}</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    className={`h-3 w-3 flex-none transition-transform ${open ? 'rotate-180' : ''}`}
                    fill="none"
                    style={{ color: tone.muted }}
                  >
                    <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )
            }}
          />
        </div>
      </div>

      <div className="flex flex-col">
        <ColorRow
          id={`${prefix}-accent`}
          label={t('themeEditor.accent')}
          value={slot.accent}
          tone={tone}
          fieldBg={fieldBg}
          divider={divider}
          ruleColor={divider}
          onChange={(next) => patch({ accent: next })}
        />
        <ColorRow
          id={`${prefix}-background`}
          label={t('themeEditor.background')}
          value={slot.background}
          tone={tone}
          fieldBg={fieldBg}
          divider={divider}
          showTopRule
          ruleColor={divider}
          onChange={(next) => patch({ background: next })}
        />
        <ColorRow
          id={`${prefix}-foreground`}
          label={t('themeEditor.foreground')}
          value={slot.foreground}
          tone={tone}
          fieldBg={fieldBg}
          divider={divider}
          showTopRule
          ruleColor={divider}
          onChange={(next) => patch({ foreground: next })}
        />

        <div
          className="flex items-center gap-3 border-t border-solid px-4 py-3"
          style={{ borderTopColor: divider }}
        >
          <label
            htmlFor={`${prefix}-contrast`}
            className="flex-1 text-[12px] font-medium"
            style={{ color: tone.primary }}
          >
            {t('themeEditor.contrast')}
          </label>
          <input
            id={`${prefix}-contrast`}
            name={`${prefix}-contrast`}
            type="range"
            min={0}
            max={100}
            value={slot.contrast}
            onChange={(e) => onSlotChange({ ...slot, contrast: Number(e.target.value) })}
            className="w-[180px] h-1.5"
            style={{ accentColor: slot.accent }}
          />
          <span className="w-7 text-right font-mono text-[11px] tabular-nums" style={{ color: tone.muted }}>
            {slot.contrast}
          </span>
        </div>
      </div>
    </section>
  )
}

export default function ThemeEditorSection(props: {
  state: ThemeEditorStateV1
  onChange: (s: ThemeEditorStateV1) => void
  themeSource: 'system' | 'light' | 'dark'
  onThemeMode: (m: 'system' | 'light' | 'dark') => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { state, onChange, themeSource, onThemeMode } = props
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const preferredMode =
    themeSource === 'system'
      ? (systemDark ? 'dark' : 'light')
      : themeSource

  const orderedSides = preferredMode === 'dark'
    ? ([
        {
          title: t('themeEditor.darkTheme'),
          mode: 'dark' as const,
          slot: state.dark,
          onSlotChange: (dark: ThemeSideConfig) => onChange({ ...state, dark }),
        },
        {
          title: t('themeEditor.lightTheme'),
          mode: 'light' as const,
          slot: state.light,
          onSlotChange: (light: ThemeSideConfig) => onChange({ ...state, light }),
        },
      ])
    : ([
        {
          title: t('themeEditor.lightTheme'),
          mode: 'light' as const,
          slot: state.light,
          onSlotChange: (light: ThemeSideConfig) => onChange({ ...state, light }),
        },
        {
          title: t('themeEditor.darkTheme'),
          mode: 'dark' as const,
          slot: state.dark,
          onSlotChange: (dark: ThemeSideConfig) => onChange({ ...state, dark }),
        },
      ])

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.08em] uppercase">
          {t('themeEditor.title')}
        </h4>
        <SegmentedPill
          value={themeSource}
          onChange={(value) => {
            void onThemeMode(value)
          }}
          ariaLabel={t('themeEditor.modeAria')}
          options={[
            { value: 'light', label: t('settings.theme_light') },
            { value: 'dark', label: t('settings.theme_dark') },
            { value: 'system', label: t('settings.theme_system') },
          ]}
        />
      </div>

      {orderedSides.map((side) => (
        <SideBlock
          key={side.mode}
          title={side.title}
          mode={side.mode}
          slot={side.slot}
          onSlotChange={side.onSlotChange}
        />
      ))}

    </div>
  )
}
