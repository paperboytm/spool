import { useEffect, useState, useCallback, useRef, memo, startTransition, useDeferredValue } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { FragmentResult, SearchResult, StatusInfo } from '@spool-lab/core'
import { type SearchMode } from './components/SearchBar.js'
import FragmentResults from './components/FragmentResults.js'
import SessionDetail from './components/SessionDetail.js'
import AiAnswerCard from './components/AiAnswerCard.js'
import SettingsPanel from './components/SettingsPanel.js'
import Sidebar from './components/Sidebar.js'
import ProjectView from './components/ProjectView.js'
import LibraryLanding from './components/LibraryLanding.js'
import SearchOverlay from './components/SearchOverlay.js'
import type { ScopeValue } from './components/ScopeSelector.js'
import AppTopBar from './components/AppTopBar.js'
import SidebarRail from './components/SidebarRail.js'
import AppToaster from './components/AppToaster.js'
import SharesPage from './components/SharesPage.js'
import ShareEditorPage from './components/ShareEditorPage.js'
import { composeFromSession, sessionDraftId } from './lib/compose-from-session.js'
import { draftIdForImport } from './lib/import-spool.js'
import { buildPreviewDocument, buildSpoolDocument, DEFAULT_OPTS, normalizeOpts, readSpoolFile, type Conversation, type EditorOpts, type SpoolDocument } from '@spool/share-kit'
import type { Message, Session, ShareDraftListItem, ShareDraftSourceKind } from '@spool-lab/core'
import { getSessionResumeCommandPrefix } from '../shared/resumeCommand.js'
import { DEFAULT_SEARCH_SORT_ORDER, type SearchSortOrder } from '../shared/searchSort.js'
import { DEFAULT_SIDEBAR_SORT_ORDER, type SidebarSortOrder } from '../shared/sidebarSort.js'
import { DEFAULT_PINNED_SORT_ORDER, type PinnedSortOrder } from '../shared/pinnedSort.js'
import { DEFAULT_PROJECT_SORT_ORDER } from '../shared/projectView.js'
import type { ProjectSessionSortOrder } from '@spool-lab/core'
import { defaultThemeEditorState, type ThemeEditorStateV1 } from './theme/editorTypes.js'
import { applyEditorTheme } from './theme/applyEditorTheme.js'
import { loadThemeEditorState, saveThemeEditorState } from './theme/persist.js'
import { useHotkeys } from './hooks/useHotkeys.js'
import { useLanguageBootstrap } from './i18n/useLanguageBootstrap.js'
import type { LanguagePreference } from '../preload/index.js'
import { useFeature } from './featureFlags.js'

type View = 'search' | 'session' | 'shares' | 'share-editor'
type SettingsTab = 'general' | 'appearance' | 'shortcuts' | 'sources' | 'agent' | 'labs'

type FragmentSearchResult = FragmentResult & { kind: 'fragment' }

interface AgentInfo {
  id: string
  name: string
  path: string
  status: 'ready' | 'not_found' | 'not_running'
  acpMode: 'extension' | 'native' | 'websocket'
}

interface RuntimeInfo {
  isDev: boolean
  appPath: string
  appName: string
}

export default function App() {
  const { t } = useTranslation()
  const shareEnabled = useFeature('share')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [previewSuggestions, setPreviewSuggestions] = useState<SearchResult[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null)
  const [view, setView] = useState<View>('search')
  const [homeMode, setHomeMode] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ phase: string; count: number; total: number } | null>(null)
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestSeq = useRef(0)
  const previewRequestSeq = useRef(0)

  // AI mode state
  const [searchMode, setSearchMode] = useState<SearchMode>('fast')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiAgent, setAiAgent] = useState('claude')
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([])
  const [aiToolCalls, setAiToolCalls] = useState<Map<string, { title: string; status: string; kind?: string | undefined }>>(new Map())
  const [aiSession, setAiSession] = useState<{ sessionUuid: string; source: string; cwd: string } | null>(null)
  const aiAnswerRef = useRef('')

  // Settings & modals
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [defaultSearchSort, setDefaultSearchSort] = useState<SearchSortOrder>(DEFAULT_SEARCH_SORT_ORDER)
  const [sidebarShowSourceDots, setSidebarShowSourceDots] = useState(true)
  const [sidebarShowSessionCount, setSidebarShowSessionCount] = useState(true)
  const [sidebarSortOrder, setSidebarSortOrder] = useState<SidebarSortOrder>(DEFAULT_SIDEBAR_SORT_ORDER)
  const [pinnedSortOrder, setPinnedSortOrder] = useState<PinnedSortOrder>(DEFAULT_PINNED_SORT_ORDER)
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSessionSortOrder>(DEFAULT_PROJECT_SORT_ORDER)
  const [themeEditor, setThemeEditor] = useState<ThemeEditorStateV1>(() => defaultThemeEditorState())
  // undefined until AgentsConfig has loaded — useLanguageBootstrap skips
  // until then so the cached locale (set by the last applyLanguage call)
  // isn't transiently overwritten by the system fallback while config IPC
  // is still in flight. Otherwise users see zh-CN → en → zh-CN flash.
  const [language, setLanguage] = useState<LanguagePreference | undefined>(undefined)
  useLanguageBootstrap(language)
  const themeHydrated = useRef(false)
  const deferredResults = useDeferredValue(results)
  const [lastCompletedPreviewQuery, setLastCompletedPreviewQuery] = useState('')
  const [activeProjectKey, setActiveProjectKey] = useState<string | null>(null)
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null)
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false)
  const [searchScopeProject, setSearchScopeProject] = useState<ScopeValue | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sharePanelOpen, setSharePanelOpen] = useState(true)
  /** Active share-editor session: conversation, the user's last
   *  accepted opts, and the draft-row metadata the editor needs to
   *  upsert autosaves back into share_drafts. Cleared on Back. */
  type ShareEditorBundle = {
    draftId: string
    sourceKind: ShareDraftSourceKind
    sourceOrigin: string | null
    conversation: Conversation
    opts: EditorOpts
  }
  const [shareEditor, setShareEditor] = useState<ShareEditorBundle | null>(null)
  // The view the user came from when opening the editor — Back returns
  // here. Captured up front because guessing from current state
  // (selectedSession etc.) misroutes when the user opens a draft from
  // the Shares page while a session is also selected.
  const [shareEditorReturnView, setShareEditorReturnView] = useState<View>('search')

  // Remembers the sidebar fold state at the moment the user entered
  // the share editor, so we can restore it on exit. Lives outside
  // React state because it isn't part of any render output.
  const sidebarRestoreRef = useRef<boolean | null>(null)

  // Auto-collapse the left sidebar synchronously alongside the view
  // change so the share editor renders with sidebar=collapsed on its
  // very first paint. Doing this asynchronously via useEffect causes
  // PreviewPane's initial fit measurement to sample a mid-animation
  // pane width and produce a too-small scale.
  const enterShareEditor = useCallback((nextSidebarCollapsed: boolean) => {
    if (!nextSidebarCollapsed) {
      sidebarRestoreRef.current = nextSidebarCollapsed
      setSidebarCollapsed(true)
    } else {
      sidebarRestoreRef.current = null
    }
  }, [])

  const openShareEditor = useCallback((bundle: ShareEditorBundle, returnView: View) => {
    enterShareEditor(sidebarCollapsed)
    setShareEditor(bundle)
    setShareEditorReturnView(returnView)
    setView('share-editor')
  }, [enterShareEditor, sidebarCollapsed])

  const handleStartShareFromSession = useCallback(async (session: Session, messages: Message[], returnView: View = 'session') => {
    const draftId = sessionDraftId(session.sessionUuid)
    // If the user has shared this session before, reopen their saved
    // draft (their edits to template / paper / typeface / etc. are in
    // the snapshot). Only when no draft exists do we build a fresh
    // one with DEFAULT_OPTS and persist it.
    let conversation: Conversation
    let opts: EditorOpts
    try {
      const existing = await window.spool?.shareDraft?.get(draftId)
      if (existing) {
        const doc = JSON.parse(existing.snapshot_json) as SpoolDocument
        conversation = doc.conversation
        // Merge with DEFAULT_OPTS so a snapshot saved before a new
        // EditorOpts field landed (e.g. colorway, density) doesn't
        // leave that field undefined and crash TEMPLATE_RATIO lookups
        // / PreviewPane's TemplateRender downstream.
        opts = normalizeOpts(doc.opts)
      } else {
        conversation = composeFromSession(session, messages)
        opts = DEFAULT_OPTS
        const doc = buildSpoolDocument(conversation, opts)
        await window.spool?.shareDraft?.upsert({
          draft_id: draftId,
          source_kind: 'spool-session',
          source_origin: session.sessionUuid,
          title: conversation.title,
          snapshot_json: JSON.stringify(doc),
          preview_json: JSON.stringify(buildPreviewDocument(doc)),
        })
      }
    } catch (err) {
      console.error('Failed to load or persist share draft, falling back to a fresh compose:', err)
      conversation = composeFromSession(session, messages)
      opts = DEFAULT_OPTS
    }
    openShareEditor({
      draftId,
      sourceKind: 'spool-session',
      sourceOrigin: session.sessionUuid,
      conversation,
      opts,
    }, returnView)
  }, [openShareEditor])

  const handleStartShareFromUuid = useCallback(async (sessionUuid: string) => {
    try {
      const result = await window.spool?.getSession(sessionUuid)
      if (!result) {
        console.error('Cannot share — session not found:', sessionUuid)
        return
      }
      await handleStartShareFromSession(result.session, result.messages, view)
    } catch (err) {
      console.error('Failed to load session for share:', err)
    }
  }, [handleStartShareFromSession, view])

  const handleImportSpoolFile = useCallback(async (file: File) => {
    let doc: SpoolDocument
    try {
      doc = await readSpoolFile(file)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('toast.importFailed_readError')
      toast.error(t('toast.importFailed_title', { name: file.name }), { description: message })
      return
    }
    try {
      const opts: EditorOpts = normalizeOpts(doc.opts)
      const normalized: SpoolDocument = { ...doc, opts }
      const normalizedJson = JSON.stringify(normalized)
      const draftId = await draftIdForImport(normalizedJson)
      await window.spool?.shareDraft?.upsert({
        draft_id: draftId,
        source_kind: 'imported-file',
        source_origin: file.name,
        title: normalized.conversation.title,
        snapshot_json: normalizedJson,
        preview_json: JSON.stringify(buildPreviewDocument(normalized)),
      })
      openShareEditor({
        draftId,
        sourceKind: 'imported-file',
        sourceOrigin: file.name,
        conversation: normalized.conversation,
        opts,
      }, 'shares')
    } catch (err) {
      console.error('Failed to persist imported .spool draft:', err)
      toast.error(t('toast.importFailed_title', { name: file.name }), { description: t('toast.importFailed_saveError') })
    }
  }, [openShareEditor])

  const handleOpenDraft = useCallback(async (draft: ShareDraftListItem) => {
    // The list query intentionally omits snapshot_json — fetch the
    // full row before parsing so the editor gets the complete
    // conversation rather than the truncated preview blob.
    try {
      const full = await window.spool?.shareDraft?.get(draft.draft_id)
      if (!full) {
        console.error('Draft vanished between list and open:', draft.draft_id)
        return
      }
      const doc = JSON.parse(full.snapshot_json) as SpoolDocument
      openShareEditor({
        draftId: draft.draft_id,
        sourceKind: draft.source_kind,
        sourceOrigin: draft.source_origin,
        conversation: doc.conversation,
        opts: normalizeOpts(doc.opts),
      }, 'shares')
    } catch (err) {
      console.error('Failed to parse draft snapshot:', err)
    }
  }, [openShareEditor])

  const handleCloseShareEditor = useCallback(() => {
    setShareEditor(null)
    setView(shareEditorReturnView)
  }, [shareEditorReturnView])

  useEffect(() => {
    if (!window.spool?.getSidebarCollapsed) return
    window.spool.getSidebarCollapsed()
      .then(setSidebarCollapsed)
      .catch(console.error)
  }, [])

  // Restore the pre-editor sidebar state when the user leaves the
  // share editor — by Back button, by clicking into a sidebar
  // destination, or any other path that moves view away. Skip when
  // the user manually re-expanded the sidebar mid-edit so their
  // explicit choice wins.
  useEffect(() => {
    if (view === 'share-editor' || sidebarRestoreRef.current === null) return
    const restore = sidebarRestoreRef.current
    sidebarRestoreRef.current = null
    if (sidebarCollapsed) setSidebarCollapsed(restore)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      void window.spool?.setSidebarCollapsed?.(next)
      return next
    })
  }, [])

  const showProjectView = activeProjectKey !== null && view === 'search' && !selectedSession && !query.trim()
  const showSearchResults = view === 'search' && !selectedSession && !!query.trim()
  const isHomeMode = homeMode && view === 'search' && !selectedSession && !showProjectView && !showSearchResults
  const isSharesView = shareEnabled && view === 'shares'
  const isShareEditorView = shareEnabled && view === 'share-editor'

  // Bounce out of share-only views when the user disables the flag from
  // Settings → Labs. Mirror the Back button's behaviour for the editor:
  // return to wherever the user came from. /shares is a top-level entry
  // with no remembered source, so it falls through to Library.
  useEffect(() => {
    if (shareEnabled) return
    if (view !== 'shares' && view !== 'share-editor') return
    setShareEditor(null)
    const editorReturnsToShareSurface =
      shareEditorReturnView === 'shares' || shareEditorReturnView === 'share-editor'
    if (view === 'share-editor' && !editorReturnsToShareSurface) {
      setView(shareEditorReturnView)
    } else {
      setSelectedSession(null)
      setTargetMessageId(null)
      setHomeMode(true)
      setView('search')
    }
    toast(t('labs.share.disabled_toast'))
  }, [shareEnabled, view, shareEditorReturnView, t])

  useEffect(() => {
    loadThemeEditorState()
      .then(setThemeEditor)
      .catch(console.error)
      .finally(() => {
        themeHydrated.current = true
      })
  }, [])

  useEffect(() => {
    applyEditorTheme(themeEditor)
  }, [themeEditor])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      applyEditorTheme(themeEditor)
    }
    mq.addEventListener('change', onScheme)
    return () => mq.removeEventListener('change', onScheme)
  }, [themeEditor])

  useEffect(() => {
    if (!themeHydrated.current) return
    const t = window.setTimeout(() => {
      saveThemeEditorState(themeEditor).catch(console.error)
    }, 400)
    return () => window.clearTimeout(t)
  }, [themeEditor])

  // Load agents + config, apply configured default
  const refreshAgents = useCallback(() => {
    if (!window.spool?.getAiAgents) return
    Promise.all([
      window.spool.getAiAgents(),
      window.spool.getAgentsConfig(),
    ]).then(([agents, config]) => {
      const ready = agents.filter(a => a.status === 'ready')
      setAvailableAgents(ready)
      setDefaultSearchSort(config.defaultSearchSort ?? DEFAULT_SEARCH_SORT_ORDER)
      setSidebarShowSourceDots(config.sidebarShowSourceDots ?? true)
      setSidebarShowSessionCount(config.sidebarShowSessionCount ?? true)
      setSidebarSortOrder(config.sidebarSortOrder ?? DEFAULT_SIDEBAR_SORT_ORDER)
      setPinnedSortOrder(config.pinnedSortOrder ?? DEFAULT_PINNED_SORT_ORDER)
      setProjectSortOrder(config.projectSortOrder ?? DEFAULT_PROJECT_SORT_ORDER)
      setLanguage(config.language ?? 'system')
      const defaultId = config.defaultAgent && ready.find(a => a.id === config.defaultAgent)
        ? config.defaultAgent
        : ready[0]?.id
      if (defaultId) setAiAgent(defaultId)
    }).catch(console.error)
  }, [])

  // Detect available ACP agents on mount
  useEffect(() => { refreshAgents() }, [])

  const handleSidebarSortChange = useCallback(async (next: SidebarSortOrder) => {
    setSidebarSortOrder(next)
    if (!window.spool?.setAgentsConfig) return
    try {
      const config = await window.spool.getAgentsConfig()
      await window.spool.setAgentsConfig({ ...config, sidebarSortOrder: next })
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handlePinnedSortChange = useCallback(async (next: PinnedSortOrder) => {
    setPinnedSortOrder(next)
    if (!window.spool?.setAgentsConfig) return
    try {
      const config = await window.spool.getAgentsConfig()
      await window.spool.setAgentsConfig({ ...config, pinnedSortOrder: next })
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handleLanguageChange = useCallback(async (next: LanguagePreference) => {
    setLanguage(next)
    if (!window.spool?.setAgentsConfig) return
    try {
      const config = await window.spool.getAgentsConfig()
      await window.spool.setAgentsConfig({ ...config, language: next })
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handleProjectSortChange = useCallback(async (next: ProjectSessionSortOrder) => {
    setProjectSortOrder(next)
    if (!window.spool?.setAgentsConfig) return
    try {
      const config = await window.spool.getAgentsConfig()
      await window.spool.setAgentsConfig({ ...config, projectSortOrder: next })
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      if (syncRefreshTimer.current) clearTimeout(syncRefreshTimer.current)
    }
  }, [])

  // Listen for AI streaming chunks and tool calls
  useEffect(() => {
    if (!window.spool?.onAiChunk) return () => {}
    const offChunk = window.spool.onAiChunk(({ text }) => {
      aiAnswerRef.current += text
      setAiAnswer(aiAnswerRef.current)
    })
    const offDone = window.spool.onAiDone(({ error }) => {
      setAiStreaming(false)
      if (error) setAiError(error)
    })
    const offToolCall = window.spool.onAiToolCall?.((tc) => {
      setAiToolCalls(prev => {
        const next = new Map(prev)
        const previous = prev.get(tc.toolCallId)
        next.set(tc.toolCallId, {
          title: tc.title || previous?.title || '',
          status: tc.status,
          ...(tc.kind ? { kind: tc.kind } : previous?.kind ? { kind: previous.kind } : {}),
        })
        return next
      })
    })
    const offSession = window.spool.onAiSessionStarted?.((info) => {
      setAiSession(info)
    })
    return () => { offChunk(); offDone(); offToolCall?.(); offSession?.() }
  }, [])

  useEffect(() => {
    if (!window.spool) return
    window.spool.getRuntimeInfo?.().then(setRuntimeInfo).catch(console.error)
  }, [])

  useEffect(() => {
    if (!window.spool) return
    if (syncStatus && syncStatus.phase !== 'done') return
    window.spool.getStatus().then(setStatus).catch(console.error)
  }, [syncStatus?.phase])

  useEffect(() => {
    if (!window.spool) return () => {}
    const scheduleSearchRefresh = () => {
      if (!query.trim() || searchMode !== 'fast') return
      if (syncRefreshTimer.current) clearTimeout(syncRefreshTimer.current)
      syncRefreshTimer.current = setTimeout(() => {
        syncRefreshTimer.current = null
        doSearch(query)
      }, 250)
    }
    const offProgress = window.spool.onSyncProgress((e) => {
      setSyncStatus(e)
      if (e.phase === 'syncing' || e.phase === 'indexing') {
        scheduleSearchRefresh()
      }
      if (e.phase === 'done') {
        if (syncRefreshTimer.current) {
          clearTimeout(syncRefreshTimer.current)
          syncRefreshTimer.current = null
        }
        setTimeout(() => setSyncStatus(null), 3000)
        if (query.trim() && searchMode === 'fast') doSearch(query)
      }
    })
    const offNew = window.spool.onNewSessions(() => {
      window.spool.getStatus().then(setStatus).catch(console.error)
      scheduleSearchRefresh()
    })
    return () => { offProgress(); offNew() }
  }, [query, searchMode])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setIsSearching(false); return }
    const requestId = ++searchRequestSeq.current
    setIsSearching(true)
    const scopedKey = searchScopeProject?.identityKey
    try {
      const res = window.spool ? await window.spool.search(q, 20, undefined, false, scopedKey) : []
      if (requestId !== searchRequestSeq.current) return
      startTransition(() => {
        setResults(res)
      })
    } finally {
      if (requestId === searchRequestSeq.current) {
        setIsSearching(false)
      }
    }
  }, [searchScopeProject])

  const doPreviewSearch = useCallback(async (q: string) => {
    if (!q.trim() || !window.spool?.searchPreview) {
      setPreviewSuggestions([])
      setLastCompletedPreviewQuery(q)
      return
    }

    const requestId = ++previewRequestSeq.current
    const suggestions = await window.spool.searchPreview(q, 5)
    if (requestId !== previewRequestSeq.current) return
    startTransition(() => {
      setPreviewSuggestions(suggestions)
    })
    setLastCompletedPreviewQuery(q)
  }, [])

  const doAiSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim()
    if (!q || !window.spool?.aiSearch) return

    const scopedKey = searchScopeProject?.identityKey
    const ftsResults = results.length > 0 ? results : (window.spool ? await window.spool.search(q, 20, undefined, false, scopedKey) : [])
    if (ftsResults.length > 0 && results.length === 0) setResults(ftsResults)
    const fragmentContext = ftsResults.filter((result): result is FragmentResult & { kind: 'fragment' } => result.kind === 'fragment')

    aiAnswerRef.current = ''
    setAiAnswer('')
    setAiError(null)
    setAiStreaming(true)
    setAiToolCalls(new Map())
    setAiSession(null)

    window.spool.aiSearch(q, aiAgent, fragmentContext).catch((err) => {
      setAiError(String(err))
      setAiStreaming(false)
    })
  }, [query, aiAgent, results, searchScopeProject])

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q)
    if (!q.trim()) setHomeMode(true)
    if (searchMode === 'fast') {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchTimer.current = setTimeout(() => doSearch(q), 120)
      void doPreviewSearch(q)
    }
    if (aiAnswer || aiError) {
      setAiAnswer('')
      setAiError(null)
      aiAnswerRef.current = ''
    }
  }, [doPreviewSearch, doSearch, searchMode, aiAnswer, aiError])

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return
    setHomeMode(false)
    setSelectedSession(null)
    setTargetMessageId(null)
    setView('search')
    if (searchMode === 'ai') {
      doAiSearch()
    } else {
      doSearch(query)
    }
  }, [searchMode, doAiSearch, doSearch, query])

  const handleModeChange = useCallback((mode: SearchMode) => {
    setSearchMode(mode)
    if (mode === 'fast') {
      setAiAnswer('')
      setAiError(null)
      setAiStreaming(false)
      setAiToolCalls(new Map())
      aiAnswerRef.current = ''
      if (query.trim()) {
        setHomeMode(false)
        setSelectedSession(null)
        setTargetMessageId(null)
        setView('search')
        doSearch(query)
      }
    } else {
      setResults([])
      setIsSearching(false)
    }
  }, [query, doSearch])

  const handleSelectSuggestion = useCallback((uuid: string, messageId?: number) => {
    setHomeMode(false)
    setSelectedSession(uuid)
    setTargetMessageId(messageId ?? null)
    setView('session')
  }, [])

  const handleOpenSession = useCallback((uuid: string, messageId?: number) => {
    setSelectedSession(uuid)
    setTargetMessageId(messageId ?? null)
    setView('session')
  }, [])

  const handleBack = useCallback(() => {
    setView('search')
    setSelectedSession(null)
    setTargetMessageId(null)
  }, [])

  const handleClearResults = useCallback(() => {
    setQuery('')
    setResults([])
    setAiAnswer('')
    setAiError(null)
    setAiStreaming(false)
    aiAnswerRef.current = ''
    setSelectedSession(null)
    setTargetMessageId(null)
    setHomeMode(activeProjectKey === null)
    setView('search')
  }, [activeProjectKey])

  // ⌘K opens overlay (suppressed when a modal layer is on top, e.g. Settings)
  // ⌘B toggles the sidebar — macOS convention shared with Mail, Notes, Xcode.
  useHotkeys({
    'mod+k': () => setSearchOverlayOpen(open => !open),
    'mod+b': () => toggleSidebar(),
  })

  // Default scope follows active project: entering a project context
  // pre-fills the search scope to that project; leaving clears it.
  useEffect(() => {
    if (activeProjectKey && activeProjectName) {
      setSearchScopeProject({ identityKey: activeProjectKey, displayName: activeProjectName })
    } else {
      setSearchScopeProject(null)
    }
  }, [activeProjectKey, activeProjectName])

  // Resolve active project name for scope chip label
  useEffect(() => {
    if (!activeProjectKey) {
      setActiveProjectName(null)
      return
    }
    let cancelled = false
    window.spool.listProjectGroups()
      .then(groups => {
        if (cancelled) return
        const match = groups.find(g => g.identityKey === activeProjectKey)
        setActiveProjectName(match?.displayName ?? null)
      })
      .catch(() => { if (!cancelled) setActiveProjectName(null) })
    return () => { cancelled = true }
  }, [activeProjectKey])

  const handleSearchOpen = useCallback(() => setSearchOverlayOpen(true), [])
  const handleSearchClose = useCallback(() => setSearchOverlayOpen(false), [])
  const handleSearchCommit = useCallback((q: string) => {
    setSearchOverlayOpen(false)
    setQuery(q)
    setHomeMode(false)
    setSelectedSession(null)
    setTargetMessageId(null)
    setView('search')
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (searchMode === 'ai') {
      void doAiSearch(q)
    } else {
      void doSearch(q)
    }
  }, [doSearch, doAiSearch, searchMode])

  const handleOpenResultFromOverlay = useCallback((uuid: string, messageId: number | undefined, q: string) => {
    setSearchOverlayOpen(false)
    setSelectedSession(uuid)
    setTargetMessageId(messageId ?? null)
    setView('session')
    if (q.trim() && q !== query) {
      setQuery(q)
      setHomeMode(false)
      void doSearch(q)
    }
  }, [query, doSearch])

  const handleCopySessionId = useCallback((source: FragmentResult['source']) => {
    const command = getSessionResumeCommandPrefix(source)
    if (!command) return
    toast.success(t('toast.copiedSessionId'), {
      id: 'resume-command',
      description: (
        <span>
          {t('toast.copiedSessionId_description')}{' '}
          <code className="rounded bg-warm-bg dark:bg-dark-bg px-1.5 py-0.5 font-mono text-[11px]">
            {command}
          </code>
        </span>
      ),
    })
  }, [t])

  const activeAgentInfo = availableAgents.find(a => a.id === aiAgent) ?? availableAgents[0]
  const activeAgentName = activeAgentInfo?.name ?? aiAgent
  const hasAgents = availableAgents.length > 0
  const fragmentSources = deferredResults.filter((result): result is FragmentSearchResult => result.kind === 'fragment')
  const fragmentPreview = previewSuggestions.filter((result): result is FragmentSearchResult => result.kind === 'fragment')

  const sidebarElement = (
    <Sidebar
      activeIdentityKey={activeProjectKey}
      activeSessionUuid={view === 'session' ? selectedSession : null}
      isLibraryActive={isHomeMode}
      onSelectProject={(key) => {
        setActiveProjectKey(key)
        setHomeMode(false)
        setSelectedSession(null)
        setTargetMessageId(null)
        setView('search')
        setQuery('')
      }}
      onSelectSession={handleOpenSession}
      onSelectHome={() => {
        setActiveProjectKey(null)
        setHomeMode(true)
        setSelectedSession(null)
        setTargetMessageId(null)
        setView('search')
        setQuery('')
      }}
      {...(shareEnabled ? {
        onSelectShares: () => {
          setActiveProjectKey(null)
          setHomeMode(false)
          setSelectedSession(null)
          setTargetMessageId(null)
          setView('shares')
          setQuery('')
        },
      } : {})}
      isSharesActive={isSharesView}
      onOpenSearch={handleSearchOpen}
      syncStatus={syncStatus}
      status={status}
      showSourceDots={sidebarShowSourceDots}
      showSessionCount={sidebarShowSessionCount}
      sortOrder={sidebarSortOrder}
      onSortOrderChange={handleSidebarSortChange}
      pinnedSortOrder={pinnedSortOrder}
      onPinnedSortOrderChange={handlePinnedSortChange}
      onCopySessionId={handleCopySessionId}
      {...(shareEnabled ? { onShareSession: handleStartShareFromUuid } : {})}
      onSettingsClick={() => { setSettingsTab('general'); setShowSettings(true) }}
    />
  )

  // Share editor owns its own PageLayout (with a right panel) — short-
  // circuit App's regular two-column layout for that view.
  if (isShareEditorView && shareEditor) {
    return (
      <>
        <ShareEditorPage
          draftId={shareEditor.draftId}
          sourceKind={shareEditor.sourceKind}
          sourceOrigin={shareEditor.sourceOrigin}
          conversation={shareEditor.conversation}
          initialOpts={shareEditor.opts}
          onBack={handleCloseShareEditor}
          panelOpen={sharePanelOpen}
          onTogglePanel={() => setSharePanelOpen((v) => !v)}
          sidebar={sidebarElement}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
        />
        <AppToaster />
        {/* App-level overlays (settings, search) still mount above the
            share editor's PageLayout. */}
        {showSettings && (
          <SettingsPanel
            onClose={() => { setShowSettings(false); refreshAgents() }}
            initialTab={settingsTab}
            claudeCount={status?.claudeSessions ?? null}
            codexCount={status?.codexSessions ?? null}
            geminiCount={status?.geminiSessions ?? null}
            themeEditor={themeEditor}
            onThemeEditorChange={setThemeEditor}
            language={language ?? 'system'}
            onLanguageChange={handleLanguageChange}
          />
        )}
        <SearchOverlay
          open={searchOverlayOpen}
          initialQuery={query}
          scope={searchScopeProject}
          contextualScope={activeProjectKey && activeProjectName
            ? { identityKey: activeProjectKey, displayName: activeProjectName }
            : null}
          mode={searchMode}
          {...(hasAgents ? { onModeChange: setSearchMode } : {})}
          {...(hasAgents ? {
            agentSelector: (
              <AgentSelector
                agents={availableAgents}
                activeAgent={aiAgent}
                onSelect={setAiAgent}
              />
            )
          } : {})}
          onClose={handleSearchClose}
          onScopeChange={setSearchScopeProject}
          onCommit={handleSearchCommit}
          onOpenResult={handleOpenResultFromOverlay}
        />
      </>
    )
  }

  return (
    <div className="relative flex flex-col h-screen bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text">
      <AppTopBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      <div className="flex flex-1 min-h-0">
      <SidebarRail collapsed={sidebarCollapsed}>
      <Sidebar
        activeIdentityKey={activeProjectKey}
        activeSessionUuid={view === 'session' ? selectedSession : null}
        isLibraryActive={isHomeMode}
        onSelectProject={(key) => {
          setActiveProjectKey(key)
          setHomeMode(false)
          setSelectedSession(null)
          setTargetMessageId(null)
          setView('search')
          setQuery('')
        }}
        onSelectSession={handleOpenSession}
        onSelectHome={() => {
          setActiveProjectKey(null)
          setHomeMode(true)
          setSelectedSession(null)
          setTargetMessageId(null)
          setView('search')
          setQuery('')
        }}
        {...(shareEnabled ? {
          onSelectShares: () => {
            setActiveProjectKey(null)
            setHomeMode(false)
            setSelectedSession(null)
            setTargetMessageId(null)
            setView('shares')
            setQuery('')
          },
        } : {})}
        isSharesActive={isSharesView}
        onOpenSearch={handleSearchOpen}
        syncStatus={syncStatus}
        status={status}
        showSourceDots={sidebarShowSourceDots}
        showSessionCount={sidebarShowSessionCount}
        sortOrder={sidebarSortOrder}
        onSortOrderChange={handleSidebarSortChange}
        pinnedSortOrder={pinnedSortOrder}
        onPinnedSortOrderChange={handlePinnedSortChange}
        onCopySessionId={handleCopySessionId}
        {...(shareEnabled ? { onShareSession: handleStartShareFromUuid } : {})}
        onSettingsClick={() => { setSettingsTab('general'); setShowSettings(true) }}
      />
      </SidebarRail>
      <div className="relative flex flex-col flex-1 min-w-0">
      <div className="flex flex-col flex-1 min-h-0 relative">
        {isSharesView ? (
          <SharesPage
            onOpenDraft={handleOpenDraft}
            {...(shareEnabled ? { onImportSpool: handleImportSpoolFile } : {})}
            {...(shareEnabled ? { onStartNewDraft: handleStartShareFromUuid } : {})}
          />
        ) : isHomeMode ? (
          <LibraryLanding
            onSelectProject={(key) => {
              setActiveProjectKey(key)
              setHomeMode(false)
              setSelectedSession(null)
              setTargetMessageId(null)
              setView('search')
              setQuery('')
            }}
            onOpenSession={handleOpenSession}
            onCopySessionId={handleCopySessionId}
            {...(shareEnabled ? { onShare: handleStartShareFromUuid } : {})}
          />
        ) : (
          <>
            {!showProjectView && view !== 'session' && !!query.trim() && (
              <div className="flex items-center gap-3 px-6 pt-1.5 pb-3 flex-none">
                <button
                  type="button"
                  onClick={handleClearResults}
                  aria-label={t('common.back')}
                  title={t('common.back')}
                  className="flex-none flex items-center justify-center w-6 h-6 rounded-md text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <p className="text-xs text-warm-muted dark:text-dark-muted">
                  {t('search.resultsFor')} <span className="font-mono text-warm-text dark:text-dark-text">"{query}"</span>
                  <span aria-hidden className="mx-1.5 text-warm-faint">·</span>
                  <span data-testid="results-scope-chip" className="text-warm-faint dark:text-dark-muted">
                    {searchScopeProject
                      ? t('search.scope_project', { project: searchScopeProject.displayName })
                      : t('search.scope_all')}
                  </span>
                </p>
                {searchMode === 'ai' && availableAgents.length > 0 && (
                  <AgentSelector
                    agents={availableAgents}
                    activeAgent={aiAgent}
                    onSelect={setAiAgent}
                  />
                )}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-hidden">
              {view === 'session' && selectedSession ? (
                <SessionDetail
                  sessionUuid={selectedSession}
                  targetMessageId={targetMessageId}
                  onCopySessionId={handleCopySessionId}
                  onBack={handleBack}
                  {...(shareEnabled ? {
                    onShare: handleStartShareFromSession,
                  } : {})}
                />
              ) : showProjectView && activeProjectKey ? (
                <ProjectView
                  identityKey={activeProjectKey}
                  sortOrder={projectSortOrder}
                  onSortOrderChange={handleProjectSortChange}
                  onOpenSession={handleOpenSession}
                  onCopySessionId={handleCopySessionId}
                  {...(shareEnabled ? { onShare: handleStartShareFromUuid } : {})}
                />
              ) : (
                <div className="h-full flex flex-col overflow-hidden">
                  {searchMode === 'ai' && (aiAnswer || aiStreaming || aiError) && (
                    <AiAnswerCard
                      answer={aiAnswer}
                      streaming={aiStreaming}
                      agentName={activeAgentName}
                      sources={fragmentSources}
                      error={aiError}
                      toolCalls={aiToolCalls}
                      {...(aiSession ? {
                        onResume: () => {
                          void window.spool.resumeCLI(aiSession.sessionUuid, aiSession.source, aiSession.cwd)
                        },
                      } : {})}
                    />
                  )}
                  {searchMode === 'ai' && fragmentSources.length > 0 && (aiAnswer || aiStreaming) && (
                    <div className="px-4 pt-2 pb-1 text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em]">
                      {t('search.sourcesUsed')}
                    </div>
                  )}
                  {searchMode === 'ai' && !aiAnswer && !aiStreaming && !aiError && fragmentSources.length === 0 && query.trim() ? (
                    <div className="flex flex-col items-center justify-center h-full text-warm-faint dark:text-dark-muted gap-2 pb-12">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                        <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
                      </svg>
                      <p className="text-sm text-warm-muted dark:text-dark-muted">
                        {t('search.pressEnterToAsk', { key: 'Enter' })
                          .split('Enter')
                          .flatMap((part, i, arr) => i < arr.length - 1
                            ? [part, <kbd key={i} className="font-mono bg-warm-surface dark:bg-dark-surface px-1.5 py-0.5 rounded text-xs border border-warm-border dark:border-dark-border">Enter</kbd>]
                            : [part])}
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <FragmentResults
                        results={fragmentSources}
                        query={query}
                        onOpenSession={handleOpenSession}
                        defaultSortOrder={defaultSearchSort}
                        onCopySessionId={handleCopySessionId}
                        {...(shareEnabled ? { onShareSession: handleStartShareFromUuid } : {})}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      </div>
      </div>

      <AppToaster />

      {showSettings && (
        <SettingsPanel
          onClose={() => { setShowSettings(false); refreshAgents() }}
          initialTab={settingsTab}
          claudeCount={status?.claudeSessions ?? null}
          codexCount={status?.codexSessions ?? null}
          geminiCount={status?.geminiSessions ?? null}
          themeEditor={themeEditor}
          onThemeEditorChange={setThemeEditor}
          language={language ?? 'system'}
          onLanguageChange={handleLanguageChange}
        />
      )}

      <SearchOverlay
        open={searchOverlayOpen}
        initialQuery={query}
        scope={searchScopeProject}
        contextualScope={activeProjectKey && activeProjectName
          ? { identityKey: activeProjectKey, displayName: activeProjectName }
          : null}
        mode={searchMode}
        {...(hasAgents ? { onModeChange: setSearchMode } : {})}
        {...(hasAgents ? {
          agentSelector: (
            <AgentSelector
              agents={availableAgents}
              activeAgent={aiAgent}
              onSelect={setAiAgent}
            />
          )
        } : {})}
        onClose={handleSearchClose}
        onScopeChange={setSearchScopeProject}
        onCommit={handleSearchCommit}
        onOpenResult={handleOpenResultFromOverlay}
      />
    </div>
  )
}

const AgentSelector = memo(function AgentSelector({ agents, activeAgent, onSelect }: {
  agents: AgentInfo[]
  activeAgent: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (agents.length === 0) return null
  const active = agents.find(a => a.id === activeAgent) ?? agents[0]!

  if (agents.length <= 1) {
    return (
      <span className="text-[11px] text-warm-muted dark:text-dark-muted font-mono whitespace-nowrap flex-none">
        {active.name}
      </span>
    )
  }

  return (
    <div className="relative flex-none">
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
        className="text-[11px] text-warm-muted dark:text-dark-muted font-mono whitespace-nowrap hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        {active.name} ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-warm-bg dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
          {agents.map(a => (
            <button
              key={a.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(a.id); setOpen(false) }}
              className={`block w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors ${
                a.id === activeAgent
                  ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                  : 'text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface2'
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

