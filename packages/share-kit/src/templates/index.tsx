// TemplateRender — dispatches to the right template. Used by both the
// Editor preview pane and the export pipeline. Wrapped in an error
// boundary so a render-time crash inside any template (bad markdown,
// stale opts, surprise undefined field) never blanks the host surface —
// the editor stays interactive and the user can switch template / opts
// to recover.

import { Component, memo, type ErrorInfo, type ReactNode } from 'react'
import type { Conversation, EditorOpts, Template } from '@/lib/types'
import { paperTokens } from '@/lib/types'
import type { RedactReplacement } from './redact'
import { Forum } from './forum'
import { Letter } from './letter'
import { Timeline } from './timeline'
import { Chat } from './chat'

interface Props {
  template: Template
  convo: Conversation
  opts: EditorOpts
  /** Optional pre-computed redact list. Hosts that re-render the
   *  template with changing turn-array identities (the app preview
   *  mounts large documents progressively, growing a sliced copy each
   *  frame) MUST pass a list computed from the FULL conversation so
   *  its identity — and therefore every memoized Body — stays stable
   *  across those re-renders. When omitted, templates compute their
   *  own (reader / thumbnails, where the convo identity is stable). */
  redactList?: RedactReplacement[] | undefined
}

// memo: hosts (PreviewPane, thumbnails) re-render on local state the
// document doesn't depend on — zoom, pan, hover. Without the bailout
// every such tick reconciles the full turn tree, which on multi-
// thousand-turn documents is visible jank.
export const TemplateRender = memo(function TemplateRender(props: Props) {
  // Keying the boundary on `template` means switching templates
  // remounts a fresh boundary — a crash on one template doesn't leave
  // the user stuck looking at a fallback after they've already switched
  // away.
  return (
    <TemplateBoundary key={props.template} opts={props.opts}>
      <TemplateDispatch {...props} />
    </TemplateBoundary>
  )
})

function TemplateDispatch({ template, convo, opts, redactList }: Props) {
  // Defensive guard for cases where the conversation got into a shape
  // the templates can't handle (no turns array, etc). Without this, the
  // first `.map()` inside the template would throw to the boundary —
  // which works, but produces a needlessly alarming console error for
  // a recoverable input issue.
  if (!convo || !Array.isArray(convo.turns)) {
    return <FallbackPreview opts={opts} message="No conversation data." />
  }
  switch (template) {
    case 'forum':
      return <Forum convo={convo} opts={opts} redactList={redactList} />
    case 'letter':
      return <Letter convo={convo} opts={opts} redactList={redactList} />
    case 'timeline':
      return <Timeline convo={convo} opts={opts} redactList={redactList} />
    case 'chat':
      return <Chat convo={convo} opts={opts} redactList={redactList} />
    default:
      // Belt-and-suspenders for snapshots saved with a since-retired
      // template id (e.g. 'interview' from pre-v0.5.0 drafts that
      // somehow slipped past normalizeOpts). Fall back to Chat rather
      // than rendering nothing.
      return <Chat convo={convo} opts={opts} redactList={redactList} />
  }
}

interface BoundaryProps {
  opts: EditorOpts
  children: ReactNode
}

interface BoundaryState {
  error: Error | null
}

class TemplateBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[share-kit] template render failed:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <FallbackPreview
          opts={this.props.opts}
          message="This template couldn't render this conversation."
          detail="Try switching template, or restart the draft."
        />
      )
    }
    return this.props.children
  }
}

function FallbackPreview({
  opts,
  message,
  detail,
}: {
  opts: EditorOpts
  message: string
  detail?: string
}) {
  // Paper-toned fallback so the surface still feels like a preview, not
  // a system error. Same chrome neutrality as a regular template so the
  // editor's surrounding affordances (download / opts panel) keep
  // reading as live.
  const tokens = (() => {
    try {
      return paperTokens(opts?.paper)
    } catch {
      return { paper: '#FAF6EC', text: '#2A2620', muted: '#8A7A4E' }
    }
  })()
  return (
    <div
      style={{
        width: '100%',
        minHeight: 320,
        background: tokens.paper,
        color: tokens.text,
        padding: '96px 64px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: 'Geist Mono, ui-monospace, monospace',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: tokens.muted,
        }}
      >
        Preview unavailable
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.45, maxWidth: 360 }}>{message}</div>
      {detail && (
        <div style={{ fontSize: 12, color: tokens.muted, lineHeight: 1.5, maxWidth: 360 }}>
          {detail}
        </div>
      )}
    </div>
  )
}
