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
              <Row
                key={s.id}
                entry={s}
                label={t(`settings.shortcuts_action_${s.id}`)}
                isMac={isMac}
              />
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
      <h4 className="text-warm-faint dark:text-dark-muted mb-2 text-[11px] font-medium tracking-[0.08em] uppercase">
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
      <span className="text-warm-text dark:text-dark-text text-xs">{label}</span>
      <span className="flex flex-none items-center gap-1.5">
        {alternatives.map((combo, ai) => (
          <span key={ai} className="flex items-center gap-1.5">
            {ai > 0 && <span className="text-warm-faint dark:text-dark-muted text-[10px]">/</span>}
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
    <kbd className="border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-warm-text dark:text-dark-text inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border px-1.5 font-mono text-[10px] leading-none">
      {children}
    </kbd>
  )
}
