import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { flushSync } from 'react-dom'
import { Download, MoreHorizontal, PanelRight, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  TEMPLATE_RATIO,
  buildSpoolDocument,
  buildMarkdownDocument,
  markdownFilenameFor,
  openSaveSlot,
  writeToSlot,
  rasterizeToPngBlob,
  PngTooTallError,
  filenameForExport,
  type Conversation,
  type EditorOpts,
} from '@spool/share-kit'
import type { ShareDraftSourceKind } from '@spool-lab/core'
import PageLayout from './PageLayout.js'
import { PreviewPane, type Zoom } from './share-editor/PreviewPane.js'
import { ControlPanel } from './share-editor/ControlPanel.js'
import { ShareMenu } from './share-editor/ShareMenu.js'
import type { PublishedShareCacheItem } from '@spool-lab/core'
import { computePublishIdempotencyKey } from '../lib/publishIdempotency.js'
import { buildSnapshotFromEditor } from './share-editor/snapshot-adapter.js'
import Menu from './Menu.js'
import { buildPreviewDocument } from '@spool/share-kit'
import { useUndoableState } from '../hooks/useUndoableState.js'
import { useHotkeys } from '../hooks/useHotkeys.js'
import { useSharedDebounce } from '../hooks/useSharedDebounce.js'
import { sharePublicUrl } from '../lib/sharePublicUrl.js'
import type { PublishedRow, PublishSuccess, Visibility } from '../../shared/share-publish.js'

type Props = {
  /** Stable id of the share_drafts row to autosave into. */
  draftId: string
  sourceKind: ShareDraftSourceKind
  sourceOrigin: string | null
  conversation: Conversation
  /** Editor opts loaded from the persisted snapshot. The editor takes
   *  this as its initial state and persists any subsequent change. */
  initialOpts: EditorOpts
  onBack: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  /** PageLayout-relevant props passed down from App.tsx so the share
   *  editor can render its own PageLayout with the same sidebar/fold
   *  state as the rest of the app. */
  sidebar: ReactNode
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  trafficLightInset?: boolean
}

type SaveState = 'idle' | 'saving' | 'error'

/**
 * Phase 0 share editor page. Renders the conversation through a
 * share-kit template and lets the user export the result locally —
 * PNG via html-to-image, PDF via the kit's print-to-PDF host, .spool
 * via JSON serialization. Style picker + turn-level editing land in
 * follow-up commits.
 */
export default function ShareEditorPage({
  draftId,
  sourceKind,
  sourceOrigin,
  conversation,
  initialOpts,
  onBack,
  panelOpen,
  onTogglePanel,
  sidebar,
  sidebarCollapsed,
  onToggleSidebar,
  trafficLightInset = true,
}: Props) {
  const { t } = useTranslation()
  // opts + title share one undo stack — Cmd+Z reverts whichever was
  // edited last, which matches how users think about "undo my last
  // change" in editors. Zoom, panel collapse, save state, and modal
  // open/close are intentionally outside the stack so undo doesn't
  // walk back through navigation/UI noise the user didn't intend to
  // record.
  type EditableState = { opts: EditorOpts; title: string }
  const editable = useUndoableState<EditableState>({
    opts: initialOpts,
    title: conversation.title,
  })
  const opts = editable.state.opts
  const title = editable.state.title
  const setOpts = useCallback(
    (next: EditorOpts) => editable.set(prev => ({ ...prev, opts: next })),
    [editable],
  )
  const setTitle = useCallback(
    (next: string) => editable.set(prev => ({ ...prev, title: next })),
    [editable],
  )

  const [zoom, setZoom] = useState<Zoom>('fit')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Single source of truth for "is this draft currently published?"
  //   - `undefined` ⇒ lookup in flight, popover suppresses the form/manage
  //     flash until we know.
  //   - `null`      ⇒ no live share.
  //   - object      ⇒ live share.
  //
  // The state moves in three ways:
  //   1. Initial cache lookup on mount (fast, local).
  //   2. Background stale-while-revalidate refresh against /api/me/shares
  //      (slow, network) — closes the "another device / web revoked it"
  //      window so the editor doesn't keep showing a dead share's
  //      manage view.
  //   3. Local user action — publish, republish, unpublish — surfaced by
  //      ShareMenu via onPublishedChange.
  //
  // `mutationGen` increments on every local mutation; the SWR effect
  // captures the generation it saw at fetch start and discards its
  // result if the user has acted in the meantime. Without this, a slow
  // myShares response could overwrite a fresh publish or a just-fired
  // unpublish (race-y but observable on dev's wrangler with cold KV).
  // The cache row owns three things at once: the slug + version (drives
  // PublishSuccess), the revoked_at flag (gates manage vs publish form),
  // and the `client_request_id` content hash (drives the Unpublished
  // edits badge). Carrying it through as the single state value keeps
  // those three in lockstep — instead of three separate values that
  // can drift on a partial update.
  const [publishedRow, setPublishedRow] = useState<PublishedShareCacheItem | null | undefined>(undefined)
  const mutationGen = useRef(0)

  // Derived: PublishSuccess shape for the manage view; null when no live row.
  const published = useMemo<PublishSuccess | null | undefined>(() => {
    if (publishedRow === undefined) return undefined
    if (!publishedRow || publishedRow.revoked_at !== null) return null
    return {
      id: publishedRow.id,
      url: sharePublicUrl(publishedRow.id),
      version: publishedRow.version,
    }
  }, [publishedRow])

  const handlePublishedChange = useCallback((next: PublishSuccess | null, row?: PublishedRow) => {
    mutationGen.current += 1
    if (!next) {
      setPublishedRow(null)
      return
    }
    // Main hands us the freshly-written cache row inside the publish
    // IPC response, so we can update local state without going through
    // the cache. Bypasses the race where an in-flight myShares poll's
    // `replaceAll` would clobber main's write between our publish and
    // our re-read — the manage view would flash the new version then
    // revert to the old one. If the caller didn't supply a row (an
    // older path or a test mock), fall back to a cache re-read.
    if (row) {
      setPublishedRow(row)
      return
    }
    const localGen = mutationGen.current
    void (async () => {
      try {
        const cached = await window.spoolShare.getPublishedByDraft(draftId)
        if (mutationGen.current !== localGen) return
        if (cached && cached.revoked_at === null) setPublishedRow(cached)
      } catch (err) {
        console.warn('Refresh published row from cache after publish failed:', err)
      }
    })()
  }, [draftId])

  useEffect(() => {
    let alive = true
    setPublishedRow(undefined)
    // Reset the generation when the draft identity changes so the new
    // SWR cycle compares against itself, not against a prior draft's
    // mutation count.
    mutationGen.current = 0
    const fetchGen = mutationGen.current

    void (async () => {
      // Step 1: cache lookup. Fast; commits the initial view.
      let row: PublishedShareCacheItem | null = null
      try {
        row = await window.spoolShare.getPublishedByDraft(draftId)
      } catch (err) {
        console.warn('Lookup published share for draft (cache) failed:', err)
      }
      if (!alive) return
      // Only land the cache result if the user hasn't already acted in
      // the gap between mount and now (e.g. a very fast publish-on-mount).
      if (mutationGen.current === fetchGen) setPublishedRow(row)

      // Step 2: SWR. Refresh from /api/me/shares so a publish on
      // another surface (web Me page, second device) corrects the
      // editor. Same guard: drop the result if the user has acted.
      try {
        const remote = await window.spoolShare.myShares()
        if (!alive) return
        // Re-check the generation BEFORE writing to the cache. The
        // user can publish/revoke during the myShares fetch, and main
        // has already written the fresh row into the cache by then.
        // If we blindly call cachePublished (which is `replaceAll`),
        // we'd clobber that write with the now-stale remote snapshot
        // — the editor's manage view would briefly flash the new
        // version then revert to the old one. Skipping the cache write
        // is safe: a future SWR cycle will reconcile once the remote
        // catches up.
        if (mutationGen.current !== fetchGen) return
        const now = Date.now()
        await window.spoolShare.cachePublished(
          remote.items.map((r) => ({
            id: r.id,
            title: r.title,
            visibility: r.visibility,
            version: r.version,
            published_at: r.published_at,
            revoked_at: r.revoked_at,
            draft_id: r.draft_id,
            client_request_id: r.client_request_id,
            updated_at: now,
          })),
        )
        const refreshed = await window.spoolShare.getPublishedByDraft(draftId)
        if (!alive) return
        if (mutationGen.current !== fetchGen) return
        // Only restate when meaningful state changed; avoids re-renders
        // when SWR confirms the same row we already had.
        setPublishedRow((curr) => publishedRowEqual(curr, refreshed) ? curr : refreshed)
      } catch {
        // myShares fails when the user is signed out (401), offline, or
        // the share backend is down. The cache result from step 1 is
        // already on screen and stays good — silently drop the SWR.
      }
    })()
    return () => { alive = false }
  }, [draftId])
  // Draft title state lives in `editable.state.title` above; the rename
  // modal still uses `title` / `setTitle` directly. Empty strings persist
  // as-is during the edit but resolve to a sane fallback ("Untitled") at
  // render time so the Shares grid never shows a blank card label.
  const [renaming, setRenaming] = useState(false)

  // Refs hold the latest hook callbacks so the effects below can keep
  // empty deps and avoid rebinding on every snapshot change. Without
  // this, the keydown listener would add+remove on every edit (since
  // `editable` is a fresh object per render).
  const editableResetRef = useRef(editable.reset)
  const editableUndoRef = useRef(editable.undo)
  const editableRedoRef = useRef(editable.redo)
  editableResetRef.current = editable.reset
  editableUndoRef.current = editable.undo
  editableRedoRef.current = editable.redo

  // Switching to a different draft reuses this component instance (no
  // `key={draftId}` upstream), so the undo stack would otherwise carry
  // edits from the previous draft into the new one. Reset on draftId
  // change captures the new initial state as the bottom of the stack.
  useEffect(() => {
    editableResetRef.current({ opts: initialOpts, title: conversation.title })
    // Only fire when the draft identity changes; conversation/initialOpts
    // identity changes within the same draft are user edits already
    // routed through editable.set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  // Undo/redo dispatch through the shared hotkey stack so the modal layer
  // (Settings, etc.) can swallow them, and so editing a text input — like the
  // rename modal's title field — falls through to the browser's native undo
  // instead of triggering the editor's state undo.
  useHotkeys({
    'mod+z': () => editableUndoRef.current(),
    'mod+shift+z': () => editableRedoRef.current(),
    'mod+y': () => editableRedoRef.current(),
  }, { skipInEditable: true })
  const previewRef = useRef<HTMLDivElement | null>(null)

  // The "live" conversation passed to the preview, exporters, and the
  // autosave snapshot — has the renamed title merged in. Without this,
  // the rename modal updates the topbar but the rendered template + all
  // export paths keep the original `conversation.title`.
  const effectiveTitle = title.trim() || t('common.untitled')
  const liveConversation = useMemo(
    () => ({ ...conversation, title: effectiveTitle }),
    [conversation, effectiveTitle],
  )

  // Drift detection: if the live draft hashes to something different
  // from the publish-time content hash on the cache row, the editor
  // shows "Unpublished edits" so the user knows their next Republish
  // would actually push a new version (rather than short-circuit to
  // the existing one via the backend idempotency guard).
  //
  // We hash with the row's existing visibility so the comparison
  // isolates content drift — a visibility change is an explicit user
  // action in the publish form and triggers its own re-hash on submit.
  //
  // Legacy rows published with an expiry hashed the expiry into their
  // token; the expiry feature is gone, so those rows show the badge
  // once and the next republish normalises the token. Harmless, and
  // limited to pre-removal dogfood data.
  //
  // Legacy rows with no `client_request_id` (pre-v0.5.0 publishes
  // that never landed the column) get no badge: we have nothing to
  // compare against, so silently treating them as up-to-date is
  // better than crying wolf on every open.
  // One shared 400ms window for the two heavy post-edit follow-ups
  // (drift check + autosave): an edit wakes the main thread once and
  // both builds run back-to-back, instead of two independent timers
  // landing in the same breath.
  const followUps = useSharedDebounce(400)

  const [hasUnpublishedEdits, setHasUnpublishedEdits] = useState(false)
  useEffect(() => {
    if (
      !publishedRow ||
      publishedRow.revoked_at !== null ||
      !publishedRow.client_request_id
    ) {
      setHasUnpublishedEdits(false)
      return
    }
    let alive = true
    const rowVisibility = publishedRow.visibility as Visibility
    const rowHash = publishedRow.client_request_id
    // Debounced on the SAME window as the autosave below: the hash runs
    // the full snapshot build — redact pipeline included — which on
    // large sessions is too heavy to fire on every keystroke / policy
    // toggle. Sharing one window means an edit wakes the main thread
    // once for both follow-ups instead of two timers firing
    // back-to-back. The badge appearing 400ms later is imperceptible.
    followUps.schedule('drift', () => {
      void (async () => {
        try {
          const snapshot = buildSnapshotFromEditor({
            conversation: liveConversation,
            opts,
          })
          const key = await computePublishIdempotencyKey({
            snapshot,
            visibility: rowVisibility,
          })
          if (!alive) return
          setHasUnpublishedEdits(key !== rowHash)
        } catch (err) {
          if (!alive) return
          // Hash compute failures shouldn't lie — default to no badge.
          console.warn('Compute live draft hash for drift check failed:', err)
          setHasUnpublishedEdits(false)
        }
      })()
    })
    return () => {
      alive = false
      followUps.cancel('drift')
    }
  }, [publishedRow, liveConversation, opts, followUps])

  // Autosave opts changes back into share_drafts. Debounced so a
  // rapid sequence of clicks (e.g. paging through colorways) collapses
  // into one upsert. We skip the very first effect run — that one
  // fires on mount with the value we just loaded from disk, no need
  // to write the same bytes back. Using a didMount ref instead of
  // identity-checking opts keeps this robust even if a parent re-render
  // produces a new conversation/opts object reference with no actual
  // change in content.
  //
  // pendingInputsRef stamps the *inputs* needed to build a payload, not
  // the payload itself. The expensive part — `buildSpoolDocument` plus
  // two `JSON.stringify` calls — is moved into `flushPendingSave` so it
  // only runs once per debounce window (and once on unmount), instead
  // of synchronously on every opts change. For a 1000+ msg share that
  // saves ~hundreds of ms per click on the render thread.
  const didMountRef = useRef(false)
  type AutosaveInputs = {
    draftId: string
    sourceKind: ShareDraftSourceKind
    sourceOrigin: string | null
    effectiveTitle: string
    liveConversation: Conversation
    opts: EditorOpts
  }
  const pendingInputsRef = useRef<AutosaveInputs | null>(null)
  const flushPendingSave = useCallback(() => {
    const inputs = pendingInputsRef.current
    if (!inputs) return
    pendingInputsRef.current = null
    const doc = buildSpoolDocument(inputs.liveConversation, inputs.opts)
    const payload = {
      draft_id: inputs.draftId,
      source_kind: inputs.sourceKind,
      source_origin: inputs.sourceOrigin,
      title: inputs.effectiveTitle,
      snapshot_json: JSON.stringify(doc),
      preview_json: JSON.stringify(buildPreviewDocument(doc)),
    }
    void window.spool?.shareDraft?.upsert(payload).catch((err) =>
      console.error('Flush share draft autosave failed:', err),
    )
  }, [])

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    pendingInputsRef.current = {
      draftId, sourceKind, sourceOrigin, effectiveTitle, liveConversation, opts,
    }
    // Scheduled on the shared follow-up window (see `followUps` above).
    // Re-scheduling on each edit replaces the pending callback, so only
    // the latest stamped inputs ever feed flushPendingSave. If
    // `handleDelete` has cleared pendingInputsRef in the meantime,
    // flushPendingSave returns a no-op when it reads the ref. The
    // unmount flush below is independent of this timer.
    followUps.schedule('autosave', flushPendingSave)
  }, [opts, liveConversation, draftId, sourceKind, sourceOrigin, effectiveTitle, flushPendingSave, followUps])

  // Flush the pending autosave on component unmount — user clicked
  // Back, navigated away, or the editor was replaced by another view.
  // Without this, the 400ms debounce silently swallows the last edit
  // because React's effect cleanup clears the timer before it fires.
  //
  // We intentionally do NOT also listen for beforeunload/pagehide:
  // Electron may kill the renderer before the IPC reaches main, and
  // installing the listeners would imply a guarantee we can't keep.
  // App quit / OS sleep mid-edit will lose the last 400ms; acceptable.
  useEffect(() => {
    return () => flushPendingSave()
  }, [flushPendingSave])

  // Revoke the in-memory blob: URL when the preview modal closes so we
  // don't leak the PDF buffer for the rest of the session.
  useEffect(() => {
    if (!pdfPreview) return
    return () => URL.revokeObjectURL(pdfPreview.url)
  }, [pdfPreview])

  // Force React to commit the "Exporting…" state and let the browser
  // paint before kicking off rasterization. Without this, batched
  // updates + a blocking main thread keep the button at "Export" until
  // the work finishes, so the user gets no feedback that something is
  // happening.
  const beginSaving = useCallback(async () => {
    flushSync(() => setSaveState('saving'))
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  }, [])

  // PNG / PDF capture the LIVE preview DOM. The preview mounts large
  // documents progressively and re-renders through a deferred value, so
  // an export fired mid-fill (or right after an opts toggle) would
  // capture a partial / stale frame. Gate every DOM capture on the
  // pane's render-state callback; the timeout is a safety valve so a
  // wedged render can't brick the export button (the capture then
  // proceeds with whatever is committed, matching pre-progressive
  // behavior).
  const previewCompleteRef = useRef(true)
  const handlePreviewRenderState = useCallback((s: { complete: boolean }) => {
    previewCompleteRef.current = s.complete
  }, [])
  const waitForPreviewComplete = useCallback(async () => {
    const deadline = Date.now() + 10_000
    while (!previewCompleteRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (!previewCompleteRef.current) {
      // Timed out — the capture proceeds with whatever is committed.
      // Loud breadcrumb so a truncated export is diagnosable instead of
      // silently indistinguishable from success.
      console.warn('Preview did not reach render-complete within 10s; exporting the committed state.')
    }
  }, [])

  const exportPng = useCallback(async () => {
    const node = previewRef.current
    if (!node) return
    const width = TEMPLATE_RATIO[opts.template].w
    const height = node.scrollHeight
    // Pre-flight the canvas-axis cap BEFORE opening the save picker.
    // showSaveFilePicker creates a zero-byte file at the chosen path
    // the moment the user clicks Save in the system dialog; if we
    // then fail to write (because rasterization throws
    // PngTooTallError), that empty file is left on disk. By bailing
    // here we never reach the picker for over-sized conversations
    // and the user keeps a clean directory.
    const CANVAS_MAX_AXIS = 16384
    if (Math.max(width, height) > CANVAS_MAX_AXIS) {
      toast.error(t('shareEditor.couldntExportPng'), { description: t('shareEditor.conversationTooTall') })
      return
    }
    // PRE-PICK on the live user gesture, before any async work. If we
    // wait until after rasterization (~1-2s for a real conversation),
    // Chromium revokes the gesture and showSaveFilePicker rejects with
    // SecurityError.
    const filename = filenameForExport(liveConversation, opts.template, 'png')
    const slot = await openSaveSlot(filename, {
      description: t('shareEditor.saveDialog_png'),
      mime: 'image/png',
      ext: '.png',
    })
    if (slot.kind === 'cancelled') return

    await beginSaving()
    try {
      // The slot is picked (gesture satisfied) — now wait for the
      // preview to finish mounting/refreshing before measuring and
      // capturing, then re-measure: the pre-picker height may have been
      // taken mid-fill. rasterizeToPngBlob re-throws PngTooTallError if
      // the full height busts the canvas cap; the catch below cleans up
      // the picked slot.
      await waitForPreviewComplete()
      const fullHeight = node.scrollHeight
      const blob = await rasterizeToPngBlob(node, { width, height: fullHeight })
      await writeToSlot(slot, blob, filename)
      setSaveState('idle')
      toast.success(t('shareEditor.savedFile', { filename }))
    } catch (err) {
      console.error('Export to PNG failed:', err)
      setSaveState('error')
      // showSaveFilePicker may have already created a 0-byte file at
      // the picked path. Best-effort cleanup via the experimental
      // FileSystemFileHandle.remove() API (Chromium 110+); silently
      // no-op on older runtimes.
      if (slot.kind === 'picker') {
        const removable = slot.handle as unknown as { remove?: () => Promise<void> }
        if (typeof removable.remove === 'function') {
          await removable.remove().catch(() => {})
        }
      }
      if (err instanceof PngTooTallError) {
        toast.error(t('shareEditor.couldntExportPng'), { description: t('shareEditor.conversationTooTall') })
      } else {
        toast.error(t('shareEditor.couldntExportPng'), { description: t('shareEditor.seeConsole') })
      }
    }
  }, [beginSaving, waitForPreviewComplete, liveConversation, opts.template])

  const exportPdf = useCallback(async () => {
    const node = previewRef.current
    if (!node) return
    await beginSaving()
    // Same progressive-mount gate as PNG: serialize the DOM only once
    // the full, up-to-date document is committed.
    await waitForPreviewComplete()
    const width = TEMPLATE_RATIO[opts.template].w
    const height = node.scrollHeight
    const filename = filenameForExport(liveConversation, opts.template, 'pdf')
    try {
      const html = node.outerHTML
      const bytes = await window.spool.printToPdf(html, width, height)
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdfPreview({ url, filename })
      setSaveState('idle')
    } catch (err) {
      console.error('Export to PDF failed:', err)
      setSaveState('error')
      toast.error(t('shareEditor.couldntExportPdf'), { description: t('shareEditor.seeConsole') })
    }
  }, [beginSaving, waitForPreviewComplete, liveConversation, opts.template])

  const savePdfFromPreview = useCallback(async () => {
    if (!pdfPreview) return
    const slot = await openSaveSlot(pdfPreview.filename, {
      description: t('shareEditor.saveDialog_pdf'),
      mime: 'application/pdf',
      ext: '.pdf',
    })
    if (slot.kind === 'cancelled') return
    try {
      const res = await fetch(pdfPreview.url)
      const blob = await res.blob()
      await writeToSlot(slot, blob, pdfPreview.filename)
      toast.success(t('shareEditor.savedFile', { filename: pdfPreview.filename }))
      setPdfPreview(null)
    } catch (err) {
      console.error('Save PDF failed:', err)
      toast.error(t('shareEditor.couldntSavePdf'), { description: t('shareEditor.seeConsole') })
    }
  }, [pdfPreview])

  const handleDelete = useCallback(async () => {
    // Cancel any queued autosave first — otherwise the unmount-flush
    // (or a still-queued setTimeout) would re-insert the row we're
    // about to delete.
    pendingInputsRef.current = null
    try {
      await window.spool.shareDraft.delete(draftId)
    } catch (err) {
      console.error('Delete share draft failed:', err)
      toast.error(t('shareEditor.couldntDeleteDraft'))
      return
    }
    onBack()
  }, [draftId, onBack])

  const exportMarkdown = useCallback(async () => {
    const filename = markdownFilenameFor(liveConversation)
    const slot = await openSaveSlot(filename, {
      description: t('shareEditor.markdownDescription'),
      mime: 'text/markdown',
      ext: '.md',
    })
    if (slot.kind === 'cancelled') return

    await beginSaving()
    try {
      const md = buildMarkdownDocument(liveConversation, opts)
      const blob = new Blob([md], { type: 'text/markdown' })
      await writeToSlot(slot, blob, filename)
      setSaveState('idle')
      toast.success(t('shareEditor.savedFile', { filename }))
    } catch (err) {
      console.error('Export to Markdown failed:', err)
      setSaveState('error')
      toast.error(t('shareEditor.couldntExportMd'), { description: t('shareEditor.seeConsole') })
    }
  }, [beginSaving, liveConversation, opts])

  const exportSpoolFile = useCallback(async () => {
    // Same pre-pick discipline as PNG; JSON.stringify is fast but
    // saveBlob's picker call still needs the user gesture.
    const filename = filenameForExport(liveConversation, opts.template, 'spool')
    const slot = await openSaveSlot(filename, {
      description: t('shareEditor.spoolShareDescription'),
      mime: 'application/spool+json',
      ext: '.spool',
    })
    if (slot.kind === 'cancelled') return

    await beginSaving()
    try {
      // Sanitise the body before writing. When `redact: true` is on,
      // the downloaded .spool will contain `[redacted]` markers in
      // turn bodies instead of the original credentials — so a
      // recipient (or any process that reads the file) never sees
      // the secret. Autosave path stays raw on purpose.
      const doc = buildSpoolDocument(liveConversation, opts, { sanitize: true })
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/spool+json' })
      await writeToSlot(slot, blob, filename)
      setSaveState('idle')
      toast.success(t('shareEditor.savedFile', { filename }))
    } catch (err) {
      console.error('Export to .spool failed:', err)
      setSaveState('error')
      toast.error(t('shareEditor.couldntExportSpool'), { description: t('shareEditor.seeConsole') })
    }
  }, [beginSaving, liveConversation, opts])

  // The AppTopBar slot inherits `drag` so whitespace remains a window
  // drag handle — interactive elements must opt out individually.
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
  const topBarContent = (
    <div className="flex-1 min-w-0 flex items-center gap-2 px-3">
      <button
        type="button"
        data-testid="share-editor-back"
        onClick={onBack}
        aria-label={t('common.back')}
        title={t('common.back')}
        className="flex-none flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
        style={noDragStyle}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <div className="min-w-0 flex items-center gap-1.5">
        <h1
          data-testid="share-editor-title"
          title={title.trim() || t('common.untitled')}
          className="min-w-0 text-[13px] font-medium text-warm-text dark:text-dark-text truncate"
        >
          {title.trim() || t('common.untitled')}
        </h1>
        <Menu
          align="left"
          testId="share-editor-more"
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-label={t('shareEditor.moreOptions')}
              title={t('shareEditor.moreOptions')}
              className="flex-none inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
              style={noDragStyle}
            >
              <MoreHorizontal size={13} strokeWidth={1.6} aria-hidden />
            </button>
          )}
          items={[
            {
              label: t('shareEditor.renameDraft'),
              icon: <Pencil size={13} strokeWidth={1.6} aria-hidden />,
              onSelect: () => setRenaming(true),
            },
            {
              label: t('shareEditor.deleteDraft'),
              icon: <Trash2 size={13} strokeWidth={1.6} aria-hidden />,
              onSelect: () => setConfirmingDelete(true),
            },
          ]}
        />
      </div>
      <div className="flex-1" />
      <ShareMenu
        draftId={draftId}
        getEditorState={() => ({ conversation: liveConversation, opts })}
        onRedactAll={() => setOpts({ ...opts, redact: true, redactExclude: undefined })}
        published={published}
        hasUnpublishedEdits={hasUnpublishedEdits}
        onPublishedChange={handlePublishedChange}
        exporting={saveState === 'saving'}
        onExport={(fmt) => {
          if (fmt === 'png') void exportPng()
          else if (fmt === 'pdf') void exportPdf()
          else if (fmt === 'md') void exportMarkdown()
          else void exportSpoolFile()
        }}
      />
      <button
        type="button"
        onClick={onTogglePanel}
        title={panelOpen ? t('shareEditor.hidePanel') : t('shareEditor.showPanel')}
        aria-label={panelOpen ? t('shareEditor.hidePanel') : t('shareEditor.showPanel')}
        aria-pressed={panelOpen}
        className="flex-none inline-flex items-center justify-center w-5 h-5 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
        style={noDragStyle}
      >
        <PanelRight size={13} strokeWidth={1.75} />
      </button>
    </div>
  )

  return (
    <PageLayout
      sidebar={sidebar}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      trafficLightInset={trafficLightInset}
      topBar={topBarContent}
      rightPanel={<ControlPanel convo={liveConversation} opts={opts} setOpts={setOpts} />}
      rightPanelOpen={panelOpen}
    >
      <div className="flex flex-col h-full" data-testid="share-editor-page">
        {pdfPreview && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setPdfPreview(null)}
          >
            <div
              className="w-[80vw] max-w-[820px] h-[88vh] flex flex-col rounded-lg bg-warm-bg dark:bg-dark-bg shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-none flex items-center gap-3 px-4 py-2.5 border-b border-warm-border dark:border-dark-border">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-warm-text dark:text-dark-text truncate">{pdfPreview.filename}</p>
                  <p className="text-[10.5px] text-warm-faint dark:text-dark-muted">{t('shareEditor.pdfPreviewHint')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPdfPreview(null)}
                  className="h-7 px-2.5 rounded-md text-[12px] text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  data-testid="pdf-preview-save"
                  onClick={() => { void savePdfFromPreview() }}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity"
                >
                  <Download size={12} strokeWidth={1.8} />
                  {t('shareEditor.savePdf')}
                </button>
              </div>
              {/* `<iframe>` lets Chromium's built-in PDF MIME handler
               *  paint the preview directly — toolbar, page thumbnails,
               *  zoom controls. This relies on the renderer's CSP
               *  permitting `frame-src 'self' blob:`; with stricter
               *  values the iframe goes blank without a console hint.
               *  See csp.ts for the directive and the rationale. */}
              <iframe
                src={pdfPreview.url}
                title={t('shareEditor.pdfPreviewTitle')}
                className="flex-1 w-full border-0 bg-white"
              />
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          <PreviewPane
            ref={previewRef}
            convo={liveConversation}
            opts={opts}
            zoom={zoom}
            setZoom={setZoom}
            onRenderState={handlePreviewRenderState}
          />
        </div>
      </div>
      {renaming && (
        <RenameDraftModal
          initialTitle={title}
          onSave={setTitle}
          onClose={() => setRenaming(false)}
        />
      )}
      {confirmingDelete && (
        <DeleteDraftModal
          title={title.trim() || t('common.untitled')}
          onConfirm={async () => {
            setConfirmingDelete(false)
            await handleDelete()
          }}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </PageLayout>
  )
}

/**
 * Rename-draft modal — opens from the Pencil button next to the title.
 * Centered overlay matching the rest of the cmdk-family surfaces
 * (warm-bg backdrop blur + warm-bg panel). Esc cancels, Enter saves,
 * click outside cancels. Empty title is allowed; the caller resolves
 * the empty fallback ("Untitled") at render time.
 */
function publishedRowEqual(
  a: PublishedShareCacheItem | null | undefined,
  b: PublishedShareCacheItem | null | undefined,
): boolean {
  if (a == null && b == null) return a === b // distinguish undefined vs null intentionally
  if (a == null || b == null) return false
  // Drop `updated_at` from the comparison — the SWR refresh restamps
  // it on every fetch even when nothing else changed, so including it
  // would re-trigger a render every poll for no behavioural reason.
  return (
    a.id === b.id &&
    a.version === b.version &&
    a.revoked_at === b.revoked_at &&
    a.client_request_id === b.client_request_id
  )
}

function RenameDraftModal({
  initialTitle,
  onSave,
  onClose,
}: {
  initialTitle: string
  onSave: (next: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialTitle)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const commit = () => {
    onSave(value)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-draft-title"
      data-testid="rename-draft-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm px-4 pt-[20vh] animate-in fade-in duration-150"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4">
          <h2 id="rename-draft-title" className="text-base font-semibold text-warm-text dark:text-dark-text">
            {t('shareEditor.renameDraft')}
          </h2>
          <p className="mt-1 text-xs text-warm-faint dark:text-dark-muted">
            {t('shareEditor.renameDraft_subtitle')}
          </p>
        </div>
        <div className="px-5 pb-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
            }}
            aria-label={t('shareEditor.renameDraft_inputAria')}
            data-testid="rename-draft-input"
            className="w-full h-9 px-3 rounded border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-muted focus:outline-none focus:ring-1 focus:ring-warm-border2 dark:focus:ring-dark-border2"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            data-testid="rename-draft-save"
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Confirm-delete modal for the editor. Replaces the older click-twice
 * in-place delete chip — for editor surfaces the user is about to
 * navigate away from the deleted thing, so an explicit modal with a
 * destructive button reads more clearly than a primed-pill confirm.
 * Chrome mirrors RenameDraftModal: warm-bg backdrop blur + warm-bg panel,
 * 440px max width. Esc + click-outside + Cancel close without deleting;
 * Enter (or clicking the focused Delete) confirms.
 */
function DeleteDraftModal({
  title,
  onConfirm,
  onClose,
}: {
  title: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const deleteRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    deleteRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-draft-title"
      data-testid="delete-draft-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm px-4 pt-[20vh] animate-in fade-in duration-150"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4">
          <h2 id="delete-draft-title" className="text-base font-semibold text-warm-text dark:text-dark-text">
            {t('shareEditor.deleteDraft_confirm')}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-warm-muted dark:text-dark-muted">
            {t('shareEditor.deleteDraft_body', { title })}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            ref={deleteRef}
            type="button"
            data-testid="delete-draft-confirm"
            onClick={() => { void onConfirm() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void onConfirm()
              }
            }}
            className="px-3.5 h-8 rounded-[6px] text-[12px] font-medium text-white bg-[color:var(--color-status-error)] dark:bg-[color:var(--color-status-error-dark)] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-status-error)]/40"
          >
            {t('shareEditor.deleteConfirmBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
