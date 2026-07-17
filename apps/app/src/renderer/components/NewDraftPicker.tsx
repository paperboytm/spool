import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CommandPalette, { type PaletteRow } from './CommandPalette.js'
import type { ScopeValue } from './ScopeSelector.js'

type Props = {
  onSelect: (sessionUuid: string) => void
  onClose: () => void
}

export default function NewDraftPicker({ onSelect, onClose }: Props) {
  const { t } = useTranslation()
  const [scope, setScope] = useState<ScopeValue | null>(null)

  return (
    <CommandPalette
      testId="new-draft-picker"
      placeholder={t('newDraft.searchPlaceholder')}
      scope={scope}
      onScopeChange={setScope}
      optionsDefaultOpen
      groupRecentsByDate
      labels={{
        enterHint: t('newDraft.open'),
        noMatches: (query) => t('newDraft.empty', { query }),
        emptyNoSessions: t('newDraft.emptyNoSessions'),
        emptyInProject: (project) => t('newDraft.emptyInProject', { project }),
      }}
      onSubmit={(row: PaletteRow) => onSelect(row.sessionUuid)}
      onClose={onClose}
    />
  )
}
