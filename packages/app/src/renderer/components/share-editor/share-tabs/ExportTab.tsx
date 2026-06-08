import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Code2,
  Download,
  FileImage,
  FileText,
  Loader2,
} from 'lucide-react'

/** Canonical Spool brand mark — used here as the .spool format icon
 *  so the file type reads as our own format, not a generic package.
 *  Mirrors `packages/app/resources/icon.svg` (and share-web Chrome
 *  Wordmark) so a visual change lands in all three at once. */
function SpoolMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      <ellipse cx="16" cy="9" rx="12" ry="4.5" strokeWidth="1.8" />
      <line x1="4" y1="9" x2="4" y2="22" strokeWidth="1.8" />
      <line x1="28" y1="9" x2="28" y2="22" strokeWidth="1.8" />
      <path d="M4 22 C4 24.5 9 27 16 27 C23 27 28 24.5 28 22" strokeWidth="1.8" />
      <ellipse cx="16" cy="11" rx="7" ry="2.5" strokeWidth="1.2" />
      <line x1="9" y1="11" x2="9" y2="20" strokeWidth="1.2" />
      <line x1="23" y1="11" x2="23" y2="20" strokeWidth="1.2" />
      <path d="M9 20 C9 21.5 12 23 16 23 C20 23 23 21.5 23 20" strokeWidth="1.2" />
      <ellipse cx="16" cy="11" rx="3" ry="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export type ExportFormat = 'png' | 'pdf' | 'md' | 'spool'

type FormatDef = {
  k: ExportFormat
  icon: React.ReactNode
  /** Translation key for the format label (e.g. "PNG image"). */
  labelKey: string
  /** Translation key for the sub-copy (mono, e.g. "3× pixel ratio"). */
  subKey: string
}

// Lucide picks matching the design mockup. Per-format icons help the
// 2×2 grid scan visually rather than read as a list.
const FORMATS: FormatDef[] = [
  {
    k: 'png',
    icon: <FileImage size={15} strokeWidth={1.75} aria-hidden />,
    labelKey: 'shareEditorPanel.download_png_label',
    subKey: 'shareEditorPanel.download_png_sub',
  },
  {
    k: 'pdf',
    icon: <FileText size={15} strokeWidth={1.75} aria-hidden />,
    labelKey: 'shareEditorPanel.download_pdf_label',
    subKey: 'shareEditorPanel.download_pdf_sub',
  },
  {
    k: 'md',
    icon: <Code2 size={15} strokeWidth={1.75} aria-hidden />,
    labelKey: 'shareEditorPanel.download_md_label',
    subKey: 'shareEditorPanel.download_md_sub',
  },
  {
    k: 'spool',
    icon: <SpoolMark size={15} />,
    labelKey: 'shareEditorPanel.download_spool_label',
    subKey: 'shareEditorPanel.download_spool_sub',
  },
]

type Props = {
  /** True while an export is in flight. The Download button shows a
   *  spinner and the grid is non-interactive. */
  exporting: boolean
  onExport: (fmt: ExportFormat) => void
  /** Called after triggering an export so the popover can close —
   *  the actual save dialog / file write is async and not gated on
   *  the popover staying open. */
  onClose: () => void
}

/**
 * Export tab of the Share popover. Carries the four local-only formats
 * (PNG / PDF / Markdown / .spool) in a 2×2 grid + a Download button.
 * Nothing on this tab calls the network — every format is rendered
 * locally and the file lands in the OS save dialog.
 */
export function ExportTab({ exporting, onExport, onClose }: Props) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ExportFormat>('png')

  function handleDownload() {
    if (exporting) return
    onExport(selected)
    // Close the popover so the user's attention moves to the OS save
    // dialog (or, for non-blocking exports, just out of the editor's
    // way). The `exporting` prop will continue to reflect progress in
    // the editor topbar via the Share button's chevron / state.
    onClose()
  }

  return (
    <div className="flex flex-col">
      <fieldset disabled={exporting} className="px-4 pb-3">
        <legend className="text-[11.5px] font-medium text-warm-muted dark:text-dark-muted">
          {t('shareEditor.exportTab.format_legend')}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {FORMATS.map((f) => {
            const active = selected === f.k
            return (
              <button
                key={f.k}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`share-menu-export-${f.k}`}
                onClick={() => setSelected(f.k)}
                className={`relative text-left rounded-md p-2.5 border transition-colors ${
                  active
                    ? 'border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                    : 'border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`inline-flex w-7 h-7 items-center justify-center rounded-md ${
                      active
                        ? 'bg-accent text-white dark:bg-accent-dark'
                        : 'bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted'
                    }`}
                  >
                    {f.icon}
                  </span>
                  <span
                    className={`inline-flex w-4 h-4 items-center justify-center rounded-full border ${
                      active
                        ? 'bg-accent dark:bg-accent-dark border-accent dark:border-accent-dark'
                        : 'border-warm-border2 dark:border-dark-border2 bg-transparent'
                    }`}
                  >
                    {active && (
                      <Check size={10} strokeWidth={2.5} className="text-white" aria-hidden />
                    )}
                  </span>
                </div>
                <div className="mt-2 text-[12.5px] font-semibold text-warm-text dark:text-dark-text">
                  {t(f.labelKey)}
                </div>
                {/* Reserve two text lines on every card so a single-line
                 * description (e.g. "A4 paginated · print-ready") doesn't
                 * collapse the card to a shorter height than its 2-line
                 * neighbours. `line-clamp-2 min-h-[2.6em]` pins both
                 * the floor and the ceiling. */}
                <div className="mt-0.5 text-[11px] leading-snug text-warm-muted dark:text-dark-muted line-clamp-2 min-h-[2.6em]">
                  {t(f.subKey)}
                </div>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-warm-border/60 dark:border-dark-border/60 bg-warm-surface/40 dark:bg-dark-surface/40">
        <p className="flex-1 min-w-0 text-[11px] text-warm-muted dark:text-dark-muted leading-snug">
          {t('shareEditor.exportTab.footerHint')}
        </p>
        <button
          type="button"
          data-testid="share-menu-download"
          onClick={handleDownload}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {exporting ? (
            <Loader2 size={12} strokeWidth={1.8} className="animate-spin" aria-hidden />
          ) : (
            <Download size={12} strokeWidth={1.8} aria-hidden />
          )}
          {exporting ? t('shareEditor.exportTab.downloading') : t('shareEditor.exportTab.download')}
        </button>
      </div>
    </div>
  )
}
