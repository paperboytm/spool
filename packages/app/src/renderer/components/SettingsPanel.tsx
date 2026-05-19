import { useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentInfo, AgentsConfig, LanguagePreference } from '../../preload/index.js'
import { DEFAULT_SEARCH_SORT_ORDER, SEARCH_SORT_OPTIONS, type SearchSortOrder } from '../../shared/searchSort.js'
import type { ThemeEditorStateV1 } from '../theme/editorTypes.js'
import ThemeEditorSection from './ThemeEditorSection.js'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { useHotkeys } from '../hooks/useHotkeys.js'
import Menu from './Menu.js'
import ShortcutsTab from './ShortcutsTab.js'
import SecurityPane from './Settings/SecurityPane.js'
import { useSecurityEnabled, useSharePublish } from '../featureFlags.js'
import LabsTab from './LabsTab.js'
import SettingsAccount from './SettingsAccount.js'
import Toggle from './Toggle.js'

// ── Types ──────────────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'appearance' | 'shortcuts' | 'sources' | 'agent' | 'account' | 'labs' | 'security'

/** Must match SUPPORTED_TERMINALS in main/terminal.ts */
const TERMINAL_VALUES = ['', 'Terminal', 'iTerm2', 'Warp', 'kitty', 'Alacritty', 'WezTerm'] as const

interface Props {
  onClose: () => void
  initialTab?: SettingsTab
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
  opencodeCount: number | null
  themeEditor: ThemeEditorStateV1
  onThemeEditorChange: (next: ThemeEditorStateV1) => void
  language: LanguagePreference
  onLanguageChange: (next: LanguagePreference) => void
}

type Theme = 'system' | 'light' | 'dark'

// ── Sidebar tabs ───────────────────────────────────────────────────────────

// labelKey covers the existing locale entries; tabs whose i18n key has
// not been authored yet pass `fallbackLabel` and the renderer prefers
// it. This keeps the Account tab buildable without forcing a
// cross-locale change in this PR.
const TAB_DEFS: {
  id: SettingsTab
  labelKey: string
  fallbackLabel?: string
  icon: ReactNode
}[] = [
  {
    id: 'general',
    labelKey: 'settings.tab_general',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    ),
  },
  {
    id: 'appearance',
    labelKey: 'settings.tab_appearance',
    icon: (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v2.5M12 18.5V21M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M3 12h2.5M18.5 12H21M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
        <circle cx="12" cy="12" r="4.25" />
      </svg>
    ),
  },
  {
    id: 'shortcuts',
    labelKey: 'settings.tab_shortcuts',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" ry="2"/>
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>
      </svg>
    ),
  },
  {
    id: 'sources',
    labelKey: 'settings.tab_sources',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
        <polyline points="2 17 12 22 22 17"/>
        <polyline points="2 12 12 17 22 12"/>
      </svg>
    ),
  },
  {
    id: 'agent',
    labelKey: 'settings.tab_agent',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
      </svg>
    ),
  },
  {
    id: 'labs',
    labelKey: 'settings.tab_labs',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2v6a2 2 0 00.245.96l5.51 10.08A2 2 0 0118 22H6a2 2 0 01-1.755-2.96l5.51-10.08A2 2 0 0010 8V2"/>
        <path d="M6.453 15h11.094"/>
        <path d="M8.5 2h7"/>
      </svg>
    ),
  },
  {
    id: 'security',
    labelKey: 'settings.tab_security',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l8 4v6c0 5-4 9-8 10-4-1-8-5-8-10V6l8-4z"/>
        <path d="M12 8v4"/>
        <path d="M12 16h.01"/>
      </svg>
    ),
  },
  // Account is pinned to the bottom of the rail (after feature tabs) so
  // toggling the `sharePublish` flag — which conditionally hides this
  // row — doesn't shift Labs/Security up and down. Matches the GitHub
  // and Slack settings convention: identity sits below configuration.
  {
    id: 'account',
    labelKey: 'settings.tab_account',
    fallbackLabel: 'Account',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
]

// ── Main component ─────────────────────────────────────────────────────────

export default function SettingsPanel({
  onClose,
  initialTab = 'general',
  claudeCount,
  codexCount,
  geminiCount,
  opencodeCount,
  themeEditor,
  onThemeEditorChange,
  language,
  onLanguageChange,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const { t } = useTranslation()
  const securityEnabled = useSecurityEnabled()
  // Account tab is the spool.pro identity surface (sign-in, handle,
  // delete-account schedule). Sub-gated behind the share-publish flag
  // so the tab doesn't appear in pre-launch dev builds that don't
  // opt into the publish stack.
  const publishEnabled = useSharePublish()
  const visibleTabs = TAB_DEFS.filter(def => {
    if (def.id === 'security' && !securityEnabled) return false
    if (def.id === 'account' && !publishEnabled) return false
    return true
  })
  // If the Account tab was active when the flag flipped off, fall back
  // to General so the panel doesn't render against a hidden tab.
  const activeTab: SettingsTab = !publishEnabled && tab === 'account' ? 'general' : tab

  useHotkeys({ Escape: onClose }, { modal: true })

  return (
    <div
      data-testid="settings-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-warm-text/30 dark:bg-black/45 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[960px] h-[680px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-48px)] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border rounded-[10px] shadow-xl overflow-hidden flex">
        {/* Sidebar — width + paddings tuned to match the desktop handoff
            (220px rail, 22px vertical padding, 14px horizontal). */}
        <div className="w-[220px] flex-none bg-warm-surface dark:bg-dark-surface border-r border-warm-border dark:border-dark-border flex flex-col pt-[22px] pb-3">
          <div className="px-[14px] mb-[18px]">
            <h2 className="text-[22px] font-bold text-warm-text dark:text-dark-text leading-none">{t('settings.title')}</h2>
          </div>
          <div className="px-2 space-y-[2px]">
            {visibleTabs.map(def => (
              <button
                key={def.id}
                type="button"
                aria-pressed={activeTab === def.id}
                onClick={() => setTab(def.id)}
                className={`flex w-full items-center gap-[11px] rounded-lg h-9 px-3 text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-0 ${
                  activeTab === def.id
                    ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                    : 'text-warm-text dark:text-dark-text hover:bg-warm-bg dark:hover:bg-dark-bg'
                }`}
              >
                <span className={activeTab === def.id ? 'text-accent dark:text-accent-dark' : 'text-warm-muted dark:text-dark-muted'}>
                  {def.icon}
                </span>
                {tabLabel(t, def.labelKey, def.fallbackLabel)}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <FooterPath text={t('settings.localData_footer')} />
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-16 pt-8 pb-2">
            <h3 className="text-xl font-semibold text-warm-text dark:text-dark-text">
              {(() => {
                const def = TAB_DEFS.find(d => d.id === activeTab) ?? TAB_DEFS[0]!
                return tabLabel(t, def.labelKey, def.fallbackLabel)
              })()}
            </h3>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
              className="rounded-[6px] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-0"
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-16 pb-8 pt-4">
            {activeTab === 'general' && <GeneralTab language={language} onLanguageChange={onLanguageChange} />}
            {activeTab === 'appearance' && (
              <AppearanceTab themeEditor={themeEditor} onThemeEditorChange={onThemeEditorChange} />
            )}
            {activeTab === 'shortcuts' && <ShortcutsTab />}
            {activeTab === 'sources' && <SourcesTab claudeCount={claudeCount} codexCount={codexCount} geminiCount={geminiCount} opencodeCount={opencodeCount} />}
            {activeTab === 'agent' && <AgentTab />}
            {activeTab === 'account' && <SettingsAccount />}
            {activeTab === 'labs' && <LabsTab />}
            {activeTab === 'security' && securityEnabled && <SecurityPane />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── General Tab ────────────────────────────────────────────────────────────

function GeneralTab({
  language,
  onLanguageChange,
}: {
  language: LanguagePreference
  onLanguageChange: (next: LanguagePreference) => void
}) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AgentsConfig | null>(null)

  useEffect(() => {
    if (!window.spool) return
    window.spool.getAgentsConfig().then(setConfig).catch(console.error)
  }, [])

  if (config === null) return null

  const updateConfig = async (patch: Partial<AgentsConfig>) => {
    const next: AgentsConfig = { ...config, ...patch }
    setConfig(next)
    try { await window.spool.setAgentsConfig(next) } catch {}
  }

  const handleTerminalChange = (value: string) => {
    const next: AgentsConfig = { ...config }
    if (value) next.terminal = value
    else delete next.terminal
    setConfig(next)
    void window.spool?.setAgentsConfig(next)
  }

  const searchSortLabel = (value: SearchSortOrder): string => {
    switch (value) {
      case 'relevance': return t('fragment.sort_relevance')
      case 'newest': return t('fragment.sort_newest')
      case 'oldest': return t('fragment.sort_oldest')
    }
  }
  const searchSortOptions = SEARCH_SORT_OPTIONS.map(o => ({ value: o.value, label: searchSortLabel(o.value) }))

  return (
    <div className="space-y-6">
      {/* Language */}
      <Section title={t('settings.language_label')}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-warm-muted dark:text-dark-muted">{t('common.language')}</span>
          <SmallSelect
            value={language}
            onChange={(v) => onLanguageChange(v as LanguagePreference)}
            options={[
              { value: 'system', label: t('settings.language_system') },
              { value: 'en', label: t('settings.language_en') },
              { value: 'zh-CN', label: t('settings.language_zh_CN') },
              { value: 'zh-TW', label: t('settings.language_zh_TW') },
              { value: 'ja', label: t('settings.language_ja') },
              { value: 'ko', label: t('settings.language_ko') },
              { value: 'de', label: t('settings.language_de') },
              { value: 'fr', label: t('settings.language_fr') },
            ]}
          />
        </div>
        <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
          {t('settings.language_help')}
        </p>
      </Section>

      {/* Search */}
      <Section title={t('search.placeholder_results')}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-warm-muted dark:text-dark-muted">{t('settings.defaultSearchSort_label')}</span>
          <SmallSelect
            value={config.defaultSearchSort ?? DEFAULT_SEARCH_SORT_ORDER}
            onChange={(v) => updateConfig({ defaultSearchSort: v as SearchSortOrder })}
            options={searchSortOptions}
          />
        </div>
      </Section>

      {/* Sidebar */}
      <Section title={t('settings.sidebarOptions_title')}>
        <ToggleRow
          label={t('settings.sidebarShowSourceDots')}
          checked={config.sidebarShowSourceDots ?? true}
          onChange={(v) => updateConfig({ sidebarShowSourceDots: v })}
        />
        <div className="mt-3" />
        <ToggleRow
          label={t('settings.sidebarShowSessionCount')}
          checked={config.sidebarShowSessionCount ?? true}
          onChange={(v) => updateConfig({ sidebarShowSessionCount: v })}
        />
      </Section>

      {/* Terminal */}
      <Section title={t('settings.terminal_label')}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-warm-muted dark:text-dark-muted">{t('session.resume_inTerminal')}</span>
          <SmallSelect
            value={config.terminal ?? ''}
            onChange={handleTerminalChange}
            options={TERMINAL_VALUES.map(v => ({
              value: v,
              label: v === '' ? t('settings.terminal_auto') : v,
            }))}
          />
        </div>
        <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
          {t('settings.terminal_help')}
        </p>
      </Section>

      {/* Data */}
      <Section title={t('settings.data_section')}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-warm-muted dark:text-dark-muted">{t('settings.data_database')}</span>
          <span className="text-[11px] font-mono text-warm-faint dark:text-dark-muted">~/.spool/spool.db</span>
        </div>
      </Section>

      {/* About */}
      <Section title={t('settings.about_section')}>
        <p className="text-xs text-warm-muted dark:text-dark-muted">
          {t('settings.about_tagline')}
        </p>
        <p className="text-[11px] text-warm-faint dark:text-dark-faint mt-1">
          {t('settings.about_trademark')}
        </p>
      </Section>
    </div>
  )
}

function AppearanceTab({
  themeEditor,
  onThemeEditorChange,
}: {
  themeEditor: ThemeEditorStateV1
  onThemeEditorChange: (next: ThemeEditorStateV1) => void
}) {
  const [themeSource, setThemeSource] = useState<Theme>('system')

  useEffect(() => {
    if (!window.spool) return
    window.spool.getTheme().then(t => { if (t) setThemeSource(t) }).catch(console.error)
  }, [])

  const setThemeMode = async (t: Theme) => {
    setThemeSource(t)
    try {
      await window.spool?.setTheme(t)
    } catch (err) {
      console.error('Failed to set theme:', err)
    }
  }

  return (
    <div>
      <ThemeEditorSection
        state={themeEditor}
        onChange={onThemeEditorChange}
        themeSource={themeSource}
        onThemeMode={setThemeMode}
      />
    </div>
  )
}

// ── Sources Tab ────────────────────────────────────────────────────────────

function SourcesTab({
  claudeCount,
  codexCount,
  geminiCount,
  opencodeCount,
}: {
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
  opencodeCount: number | null
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <Section title={t('settings.sources_title')}>
        <BuiltInSource name={getSessionSourceLabel('claude')} color={getSessionSourceColor('claude')} count={claudeCount} />
        <BuiltInSource name={getSessionSourceLabel('codex')} color={getSessionSourceColor('codex')} count={codexCount} />
        <BuiltInSource name={getSessionSourceLabel('gemini')} color={getSessionSourceColor('gemini')} count={geminiCount} />
        <BuiltInSource name={getSessionSourceLabel('opencode')} color={getSessionSourceColor('opencode')} count={opencodeCount} />
      </Section>
    </div>
  )
}

// ── Agent Tab ──────────────────────────────────────────────────────────────

function AgentTab() {
  const { t } = useTranslation()
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [config, setConfig] = useState<AgentsConfig>({})

  useEffect(() => {
    if (!window.spool) return
    Promise.all([
      window.spool.getAiAgents(),
      window.spool.getAgentsConfig(),
    ]).then(([a, c]) => { setAgents(a); setConfig(c) }).catch(console.error)
  }, [])

  const cliAgents = agents
  const selectableIds = new Set(cliAgents.filter(a => a.status === 'ready').map(a => a.id))
  const selectedId = config.defaultAgent && selectableIds.has(config.defaultAgent)
    ? config.defaultAgent
    : cliAgents.find(a => a.status === 'ready')?.id ?? ''

  const updateConfig = async (patch: Partial<AgentsConfig>) => {
    const next: AgentsConfig = { ...config, ...patch }
    setConfig(next)
    try { await window.spool.setAgentsConfig(next) } catch {}
  }

  const modeLabel = (mode: AgentInfo['acpMode']): string => {
    switch (mode) {
      case 'extension': return t('settings.agentMode_extension')
      case 'native': return t('settings.agentMode_native')
      case 'websocket': return t('settings.agentMode_websocket')
      default: return mode
    }
  }

  return (
    <div className="space-y-6">
      {/* Installed Agents */}
      <Section title={t('settings.tab_agent')}>
        <div className="space-y-1.5">
          {cliAgents.map(agent => {
            const isReady = agent.status === 'ready'
            const isSelected = agent.id === selectedId
            return (
              <button
                key={agent.id}
                onClick={() => isReady && updateConfig({ defaultAgent: agent.id })}
                disabled={!isReady}
                className={`w-full flex items-center gap-3 px-3 py-3 border rounded-[6px] text-left transition-colors ${
                  isSelected
                    ? 'bg-accent-bg dark:bg-[#2A1800] border-accent/30 dark:border-accent-dark/30'
                    : isReady
                      ? 'bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
                      : 'bg-warm-bg dark:bg-dark-bg border-warm-border/50 dark:border-dark-border/50 opacity-50 cursor-not-allowed'
                }`}
              >
                <RadioDot selected={isSelected} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${isReady ? 'text-warm-text dark:text-dark-text' : 'text-warm-faint dark:text-dark-muted'}`}>
                      {agent.name}
                    </span>
                    <span className="text-[10px] font-mono text-warm-faint dark:text-dark-muted px-1.5 py-0.5 bg-warm-surface2 dark:bg-dark-surface2 rounded-[4px]">
                      {modeLabel(agent.acpMode)}
                    </span>
                  </div>
                  <span className="block text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate">
                    {isReady ? agent.path : `${agent.id} — ${t('settings.agentStatus_not_found')}`}
                  </span>
                </div>
                <span className={`text-[10px] font-medium flex-none ${isReady ? 'text-status-success dark:text-status-success-dark' : 'text-warm-faint dark:text-dark-muted'}`}>
                  {isReady ? t('settings.agentStatus_ready') : t('settings.agentStatus_not_found')}
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
          {t('settings.defaultAgent_help')}
        </p>
      </Section>
    </div>
  )
}

// ── Shared components ──────────────────────────────────────────────────────

// react-i18next's `t()` returns the raw key when a translation is
// missing. For tabs whose key isn't authored yet we want the
// human-readable fallbackLabel instead of `settings.tab_account`
// leaking into the UI.
function tabLabel(
  t: (key: string) => string,
  key: string,
  fallback?: string,
): string {
  const translated = t(key)
  return translated === key && fallback ? fallback : translated
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

function BuiltInSource({ name, color, count }: { name: string; color: string; count: number | null }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-2 h-2 rounded-full flex-none" style={{ background: color }} />
      <span className="flex-1 text-xs text-warm-text dark:text-dark-text">{name}</span>
      <span className="text-[11px] text-warm-faint dark:text-dark-muted tabular-nums font-mono">
        {count === null ? '…' : t('sidebar.sessionCount_other', { count })}
      </span>
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-warm-faint dark:text-dark-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-status-success dark:bg-status-success-dark flex-none" />
        auto
      </span>
    </div>
  )
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span className={`w-4 h-4 rounded-full border-2 flex-none flex items-center justify-center ${
      selected ? 'border-accent dark:border-accent-dark' : 'border-warm-border2 dark:border-dark-border2'
    }`}>
      {selected && <span className="w-2 h-2 rounded-full bg-accent dark:bg-accent-dark" />}
    </span>
  )
}

function SmallSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const current = options.find(o => o.value === value) ?? options[0]
  return (
    <Menu
      align="right"
      items={options.map(o => ({
        label: o.label,
        active: o.value === value,
        onSelect: () => onChange(o.value),
      }))}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggle}
          className={`inline-flex items-center gap-2 h-7 min-w-[140px] rounded-[6px] border bg-warm-surface dark:bg-dark-surface pl-3 pr-2 text-[12px] text-warm-text dark:text-dark-text outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-0 ${
            open
              ? 'border-accent dark:border-accent-dark'
              : 'border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
          }`}
        >
          <span className="flex-1 text-left truncate">{current?.label ?? value}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={`h-3 w-3 flex-none text-warm-muted dark:text-dark-muted transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    />
  )
}

function FooterPath({ text }: { text: string }) {
  const path = '~/.spool/'
  const idx = text.indexOf(path)
  const lead = idx >= 0 ? text.slice(0, idx).replace(/[\s,，:：]+$/, '').trim() : text
  const trail = idx >= 0 ? text.slice(idx + path.length).trim() : ''
  return (
    <div className="px-4 py-2 text-[11px] leading-snug text-warm-faint dark:text-dark-muted">
      <span className="block">{lead}{trail ? ` ${trail}` : ''}</span>
      {idx >= 0 && <span className="block mt-0.5 font-mono">{path}</span>}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <span className="text-xs text-warm-muted dark:text-dark-muted">{label}</span>
        {description && (
          <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-0.5">{description}</p>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  )
}
