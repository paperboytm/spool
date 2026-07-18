// Build the slim "preview" subset of a SpoolDocument that hosts cache
// alongside the full snapshot (e.g. share_drafts.preview_json). The
// preview is what a thumbnail grid renders without hydrating the full
// snapshot.
//
// Key invariant: the preview must render the same first N visible turns
// as the live editor would. Naïvely slicing `conversation.turns[0..6]`
// is wrong — when the user has excerpted via opts.selected (e.g. kept
// turns [10, 20, 30, 40, 50, 60]), or when hideEmptyTurns drops tool-
// only assistant turns, the editor's "first 6" no longer match the
// original array's first 6. The template's `selectSegments` running
// over a naïvely-sliced array would find no matching indices and
// render empty.
//
// So we apply the same selection logic the templates use, take the
// first N kept turns, and clear opts.selected + opts.hideEmptyTurns
// on the resulting preview so the thumbnail's downstream
// selectSegments doesn't re-filter and re-empty the array.

import { selectSegments } from '../../templates/selection'
import type { SpoolDocument } from '../types'

/** Number of turns the Shares-grid card thumbnail actually renders.
 *  Anything beyond this is fade-clipped, so storing them in
 *  preview_json is pure waste. */
export const PREVIEW_TURN_COUNT = 6

/**
 * Slim a SpoolDocument down to what a thumbnail grid card needs: full
 * opts (template / paper / typeface / colorway drive the look) +
 * conversation metadata + the first N turns that the editor would
 * actually render under the current selection.
 *
 * The returned document is structurally a `SpoolDocument` so callers
 * can feed it to `TemplateRender` unchanged — just smaller.
 */
export function buildPreviewDocument(doc: SpoolDocument): SpoolDocument {
  const segments = selectSegments(doc.conversation, doc.opts)
  const previewTurns = segments.turns.slice(0, PREVIEW_TURN_COUNT).map((kept) => {
    // `selectSegments` decorates with `origIndex` for templates that
    // need it; strip it back to the plain Turn shape so the preview
    // document stays serialization-compatible with the on-disk format.
    const { origIndex: _, ...turn } = kept
    return turn
  })
  return {
    ...doc,
    conversation: {
      ...doc.conversation,
      turns: previewTurns,
    },
    opts: {
      ...doc.opts,
      // Selection + empty-hiding are already baked into `previewTurns`.
      // Clear them so the thumbnail's selectSegments treats the array
      // as "show all" — without this it would try to re-apply the
      // (now-stale) selected indices, which reference the ORIGINAL
      // array positions and don't match the trimmed preview indices.
      selected: undefined,
      hideEmptyTurns: false,
    },
  }
}
