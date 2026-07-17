import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SHORTCUT_GROUPS,
  formatComboParts,
  splitAlternatives,
  type ShortcutEntry,
} from '../data/shortcuts.js'

export default function ShortcutsTab() {
  const { t } = useTranslation()
  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform),
    [],
  )

  return (
    <div className="space-y-6">
      {SHORTCUT_GROUPS.map((g) => (
        <Section key={g.id} title={t(`settings.shortcuts_group_${g.id}`)}>
          <ul>
            {g.shortcuts.map((s) => (
              <Row key={s.id} entry={s} label={t(`settings.shortcuts_action_${s.id}`)} isMac={isMac} />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.08em] uppercase mb-2">
        {title}
      </h4>
      {children}
    </div>
  )
}

function Row({ entry, label, isMac }: { entry: ShortcutEntry; label: string; isMac: boolean }) {
  const alternatives = splitAlternatives(entry.combo)
  return (
    <li className="flex items-center justify-between gap-4 py-2">
      <span className="text-xs text-warm-text dark:text-dark-text">{label}</span>
      <span className="flex items-center gap-1.5 flex-none">
        {alternatives.map((combo, ai) => (
          <span key={ai} className="flex items-center gap-1.5">
            {ai > 0 && (
              <span className="text-[10px] text-warm-faint dark:text-dark-muted">/</span>
            )}
            <span className="flex items-center gap-1">
              {formatComboParts(combo, isMac).map((part, pi) => (
                <Kbd key={pi}>{part}</Kbd>
              ))}
            </span>
          </span>
        ))}
      </span>
    </li>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="font-mono text-[10px] leading-none min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center rounded-[4px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-warm-text dark:text-dark-text">
      {children}
    </kbd>
  )
}
