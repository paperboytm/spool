import { forwardRef, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal } from 'lucide-react'
import {
  collectRedactList,
  TemplateRender,
  TEMPLATE_RATIO,
  TEMPLATES,
  type Conversation,
  type EditorOpts,
} from '@spool/share-kit'
import { useHotkeys } from '../../hooks/useHotkeys.js'
import { useProgressiveCount } from './preview-progressive.js'

export type Zoom = number | 'fit'

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const

/** Horizontal breathing room around the canvas inside the pane.
 *  px-10 (40px each side) + 20px safety so the canvas never touches
 *  the pane edge at fit. */
const FIT_HORIZONTAL_PAD = 80 + 40

/** Compute the scale that fits a canvas of natural width `ratioW` into a
 *  pane whose inner client width is `paneW`. Clamped to 5–100% so a
 *  narrow template can't blow up past native resolution. Exported so
 *  callers / tests can reason about it without measuring DOM. */
export function fitScaleFor(paneW: number, ratioW: number): number {
  const available = Math.max(paneW - FIT_HORIZONTAL_PAD, 200)
  return Math.max(0.05, Math.min(available / ratioW, 1))
}

export function nextZoomStep(current: number, direction: 1 | -1): number {
  const EPS = 0.001
  const last = ZOOM_STEPS[ZOOM_STEPS.length - 1]!
  const first = ZOOM_STEPS[0]!
  if (direction > 0) {
    return ZOOM_STEPS.find((s) => s > current + EPS) ?? last
  }
  return [...ZOOM_STEPS].reverse().find((s) => s < current - EPS) ?? first
}

type Props = {
  convo: Conversation
  opts: EditorOpts
  zoom: Zoom
  setZoom: (z: Zoom) => void
  /** Reports whether the canvas currently shows the COMPLETE, up-to-
   *  date document — all turns mounted AND the deferred render has
   *  caught up with the latest convo/opts. DOM-capturing consumers
   *  (PNG / PDF export) must wait for `complete` before reading the
   *  preview node, or they capture a partially-filled / stale frame. */
  onRenderState?: ((state: { complete: boolean }) => void) | undefined
}

/**
 * Zoom-aware preview surface. The inner rasterization target (the
 * unscaled 720px-wide template render) is exposed via a forwarded ref
 * so the export pipeline can capture it at native resolution; the
 * outer wrapper handles scaling, paper-toned backdrop, and per-pane
 * scroll.
 */
export const PreviewPane = forwardRef<HTMLDivElement, Props>(function PreviewPane(
  { convo, opts, zoom, setZoom, onRenderState },
  ref,
) {
  const { t } = useTranslation()

  // Progressive mount + deferred render. `slicedConvo` grows by chunks
  // until the full document is in; `useDeferredValue` keeps the canvas
  // re-render interruptible so a redact/opts toggle updates the control
  // panel immediately while the document refreshes in the background
  // (the previous frame stays visible — no blank flash).
  const totalTurns = convo.turns.length
  const turnCount = useProgressiveCount(totalTurns)
  const filled = turnCount >= totalTurns
  const slicedConvo = useMemo(
    () => (filled ? convo : { ...convo, turns: convo.turns.slice(0, turnCount) }),
    [convo, filled, turnCount],
  )
  // The redact list is computed from the FULL turn list so its identity
  // is stable across chunk frames. Left to the templates, the list
  // would recompute per chunk (the sliced turns array is new each
  // frame), changing every mounted Body's `redact` prop identity and
  // re-parsing the whole document once per chunk — O(n²) during fill.
  const fullRedactList = useMemo(
    () => collectRedactList(convo.turns, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convo.turns, opts.redactExclude],
  )
  const renderConvo = useDeferredValue(slicedConvo)
  const renderOpts = useDeferredValue(opts)
  const renderRedactList = useDeferredValue(fullRedactList)
  const renderComplete =
    filled &&
    renderConvo === slicedConvo &&
    renderOpts === opts &&
    renderRedactList === fullRedactList
  useEffect(() => {
    onRenderState?.({ complete: renderComplete })
  }, [renderComplete, onRenderState])

  // Canvas geometry follows the DEFERRED opts, not the urgent ones:
  // on a template switch the content takes a moment to catch up, and
  // resizing the box to the new template's ratio while the old
  // template's DOM is still committed shows the document mangled into
  // the wrong aspect for the whole catch-up window.
  const ratio = TEMPLATE_RATIO[renderOpts.template]

  const innerRef = useRef<HTMLDivElement>(null)
  const [naturalH, setNaturalH] = useState(ratio.h)
  useLayoutEffect(() => {
    if (!innerRef.current) return
    setNaturalH(Math.max(ratio.h, innerRef.current.scrollHeight))
  }, [renderConvo, renderOpts, ratio.h])

  // Size transitions are enabled one frame AFTER the document is fully
  // committed: gating on the fill counter alone re-armed them on the
  // same render the counter finished, so the LAST (largest) naturalH
  // jump still animated — the exact "pumping" the gate exists to avoid.
  const [sizeTransitions, setSizeTransitions] = useState(false)
  useEffect(() => {
    if (!renderComplete) {
      setSizeTransitions(false)
      return
    }
    const raf = requestAnimationFrame(() => setSizeTransitions(true))
    return () => cancelAnimationFrame(raf)
  }, [renderComplete])

  // Pan: drag-to-scroll on the empty backdrop / padding around the
  // canvas. Holding Space extends pan over the canvas too — that's
  // the Figma / Sketch convention and keeps mousedown on text from
  // hijacking the user's text-selection gesture.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)

  // Fit-scale is captured at mount and only refreshed when the user
  // explicitly clicks Fit. Layout-driven re-fits (panel toggle,
  // sidebar toggle, template switch) intentionally do NOT recompute —
  // the canvas stays at whatever scale the user last accepted.
  const [fitScale, setFitScale] = useState<number>(0.7)
  const measureFit = useCallback((): number => {
    const sc = scrollRef.current
    if (!sc) return 0.7
    return fitScaleFor(sc.clientWidth, ratio.w)
  }, [ratio.w])
  useLayoutEffect(() => {
    // Run once on mount — useLayoutEffect commits before paint, so
    // the canvas appears at the correct fit scale on the very first
    // frame and the user never sees a 0.7 fallback flash.
    setFitScale(measureFit())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scale = zoom === 'fit' ? fitScale : zoom

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (isTypingTarget(e.target)) return
      // Always preventDefault — even on key repeat — otherwise the
      // browser's "Space scrolls down by a page" default fires for
      // every repeat event and the preview races to the bottom.
      e.preventDefault()
      if (!e.repeat) setSpaceHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const beginPan = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-pan-ignore]')) return
    const onCanvas = canvasRef.current?.contains(target) ?? false
    if (onCanvas && !spaceHeld) return
    const sc = scrollRef.current
    if (!sc) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const sLeft = sc.scrollLeft
    const sTop = sc.scrollTop
    setIsPanning(true)
    const onMove = (m: globalThis.MouseEvent) => {
      sc.scrollLeft = sLeft - (m.clientX - startX)
      sc.scrollTop = sTop - (m.clientY - startY)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setIsPanning(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const scrollCursor = isPanning ? 'grabbing' : spaceHeld ? 'grab' : undefined

  const handleIn = () => setZoom(nextZoomStep(scale, 1))
  const handleOut = () => setZoom(nextZoomStep(scale, -1))
  const handleFit = () => {
    setFitScale(measureFit())
    setZoom('fit')
  }

  // ⌘= / ⌘+ / ⌘- / ⌘0 — drive the same zoom state as the on-screen
  // ZoomControl. Routed through useHotkeys so Settings / other modal
  // layers swallow it, and so it doesn't fire when the user is editing
  // copy in the control panel. preventDefault is handled by the hook
  // on match, which also keeps Chromium's browser-level zoom away.
  //
  // A scale ref lets each handler read the live scale without churning
  // the binding identity on every zoom tick.
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const measureFitRef = useRef(measureFit)
  measureFitRef.current = measureFit

  const zoomBindings = useMemo(() => {
    const zoomIn = () => setZoom(nextZoomStep(scaleRef.current, 1))
    const zoomOut = () => setZoom(nextZoomStep(scaleRef.current, -1))
    const zoomFit = () => {
      setFitScale(measureFitRef.current())
      setZoom('fit')
    }
    // ⌘+ ships as Shift-equals on US layouts; bind both the key-based
    // forms AND code-based variants so non-US layouts and numpad keys
    // hit the same path.
    return {
      'mod+equal': zoomIn,
      'mod+shift+equal': zoomIn,
      'mod+plus': zoomIn,
      'mod+shift+plus': zoomIn,
      'mod+code:equal': zoomIn,
      'mod+code:numpadadd': zoomIn,
      'mod+minus': zoomOut,
      'mod+code:minus': zoomOut,
      'mod+code:numpadsubtract': zoomOut,
      'mod+0': zoomFit,
      'mod+code:digit0': zoomFit,
      'mod+code:numpad0': zoomFit,
    }
  }, [setZoom])
  useHotkeys(zoomBindings, { skipInEditable: true })

  // Stash the live ratio onto the forwarded ref's parent target via
  // useImperativeHandle pattern — but since we just need the unscaled
  // 720px node for export, we forward the ref directly to innerRef
  // (the wrapped TemplateRender at natural size).
  const setRefs = (el: HTMLDivElement | null) => {
    innerRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  return (
    <div className="relative flex-1 min-w-0 flex">
      <div
        ref={scrollRef}
        data-share-preview-scroll
        onMouseDown={beginPan}
        style={scrollCursor ? { cursor: scrollCursor } : undefined}
        className="flex-1 overflow-auto scrollbar-none relative bg-warm-bg dark:bg-dark-bg cursor-grab"
      >
        <div
          className="relative px-10 py-8 flex flex-col items-center gap-3.5"
          style={{ margin: '0 auto', width: 'fit-content', minWidth: '100%', boxSizing: 'border-box' }}
        >
          {/* Header chrome above the canvas — template name + dims. */}
          <div className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.08em] font-mono text-warm-muted dark:text-dark-muted">
            <span className="w-4 h-px bg-warm-border dark:bg-dark-border" />
            {TEMPLATES.find((x) => x.id === renderOpts.template)?.name} · {ratio.w}×{Math.round(naturalH)}
            <span className="w-4 h-px bg-warm-border dark:bg-dark-border" />
          </div>
          {/* Scaled canvas — width/height transition for smooth zoom.
              The transform lives on a wrapper around the export-ref
              target, so the ref points at the untransformed natural-
              size node. That keeps export pipelines (PNG, PDF clone)
              from picking up the live preview's `scale(0.7)` and
              shipping a tiny artifact on the left of the page.
              Transitions stay off until the pane width is measured —
              otherwise the first paint at fallback scale visibly
              animates into the real scale, looking like a double zoom. */}
          <div
            ref={canvasRef}
            data-testid="share-preview-canvas"
            data-zoom={zoom === 'fit' ? 'fit' : `${Math.round(scale * 100)}`}
            className="relative overflow-hidden"
            style={{
              width: ratio.w * scale,
              height: naturalH * scale,
              boxShadow: '0 2px 6px rgba(0,0,0,.1), 0 20px 50px rgba(0,0,0,.08)',
              borderRadius: 2,
              // No size transition while the document is still filling
              // in — the canvas grows once per chunk and animating every
              // step reads as the page "pumping". Re-armed one frame
              // after the final commit (see sizeTransitions above).
              transition: sizeTransitions
                ? 'width 220ms cubic-bezier(.2,.8,.2,1), height 220ms cubic-bezier(.2,.8,.2,1)'
                : 'none',
              cursor: spaceHeld || isPanning ? 'inherit' : 'default',
            }}
          >
            <div
              style={{
                width: ratio.w,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                transition: 'transform 220ms cubic-bezier(.2,.8,.2,1)',
                willChange: 'transform',
              }}
            >
              {/* data-* attrs mirror the DEFERRED opts so they always
                  describe the DOM actually committed below — e2e and
                  styling hooks read them next to the content. The
                  data-render-complete marker is the e2e wait handle for
                  "the full, caught-up document is committed". */}
              <div
                ref={setRefs}
                data-testid="share-preview-render"
                data-template={renderOpts.template}
                data-paper={renderOpts.paper}
                data-typeface={renderOpts.typeface}
                data-colorway={renderOpts.colorway}
                data-density={renderOpts.density}
                data-render-complete={renderComplete ? '' : undefined}
                style={{ width: ratio.w, userSelect: 'text' }}
              >
                <TemplateRender
                  template={renderOpts.template}
                  convo={renderConvo}
                  opts={renderOpts}
                  redactList={renderRedactList}
                />
              </div>
            </div>
          </div>
          {/* Footer chrome below. */}
          <div className="text-[10px] font-mono tracking-[0.04em] text-warm-faint dark:text-dark-muted">
            {filled
              ? <>1 / 1 · {t('shareEditorPanel.preview_wordCount_other', { count: convo.wordCount })}</>
              : t('shareEditorPanel.preview_rendering')}
          </div>
        </div>
      </div>
      <ZoomControl
        percent={Math.round(scale * 100)}
        isFit={zoom === 'fit'}
        onIn={handleIn}
        onOut={handleOut}
        onFit={handleFit}
      />
    </div>
  )
})

type ZoomControlProps = {
  percent: number
  isFit: boolean
  onIn: () => void
  onOut: () => void
  onFit: () => void
}

function ZoomControl({ percent, isFit, onIn, onOut, onFit }: ZoomControlProps) {
  const { t } = useTranslation()
  const minPercent = ZOOM_STEPS[0]! * 100
  const maxPercent = ZOOM_STEPS[ZOOM_STEPS.length - 1]! * 100
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Collapse on outside click + Escape. Don't trap focus — the user
  // should be free to click anywhere else on the canvas and the
  // controls just tuck away.
  useEffect(() => {
    if (!expanded) return
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setExpanded(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [expanded])

  // One container, always there. Collapsed state shows just the ⋯
  // trigger. Expanded state grows leftward (since the bar is right-
  // anchored), keeping the ⋯ at the same pixel position — no jitter
  // at the user's click point. Bg stays so the trigger is visible
  // against the dark backdrop, but it's a quiet warm-surface tint
  // rather than a high-contrast pill.
  return (
    <div
      ref={rootRef}
      data-pan-ignore
      className="absolute right-4 bottom-4 z-20 flex items-center gap-0 h-5 rounded bg-warm-surface dark:bg-dark-surface text-[10.5px] text-warm-text dark:text-dark-text"
    >
      {expanded && (
        <>
          <ZoomBtn label="−" onClick={onOut} ariaLabel={t('shareEditorPanel.preview_zoomOut')} disabled={percent <= minPercent} />
          <span className="min-w-[26px] text-center select-none text-warm-text dark:text-dark-text tabular-nums">
            {percent}%
          </span>
          <ZoomBtn label="+" onClick={onIn} ariaLabel={t('shareEditorPanel.preview_zoomIn')} disabled={percent >= maxPercent} />
          <button
            type="button"
            onClick={onFit}
            aria-label={t('shareEditorPanel.preview_zoomToFit')}
            aria-pressed={isFit}
            className={`px-1.5 h-5 rounded transition-colors ${
              isFit
                ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
            }`}
          >
            {t('shareEditorPanel.preview_fit')}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? t('shareEditorPanel.preview_hideZoomControls') : t('shareEditorPanel.preview_zoomControls')}
        aria-expanded={expanded}
        title={t('shareEditorPanel.preview_zoomControls')}
        className="w-5 h-5 grid place-items-center rounded text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        <MoreHorizontal size={11} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
}

function ZoomBtn({
  label,
  onClick,
  ariaLabel,
  disabled,
}: {
  label: string
  onClick: () => void
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`w-5 h-5 grid place-items-center rounded text-[12px] leading-none ${
        disabled
          ? 'text-warm-faint dark:text-dark-muted cursor-default'
          : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 cursor-pointer'
      }`}
    >
      {label}
    </button>
  )
}
