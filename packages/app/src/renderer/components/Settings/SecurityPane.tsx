// Settings → Security pane.
//
// Today: shows the active scan profile + a [Rescan all] button + a
// disabled toggle for the optional ML provider. The actual download
// flow + WebGPU/WASM runtime detection land in a follow-up — this
// pane already lays out the surfaces the spec calls for so reviewers
// can see where it goes.

import { useEffect, useState } from 'react'
import { ShieldAlert, RotateCw } from 'lucide-react'
import type { ScanStatus } from '@spool-lab/core'
import { securityApi } from '../../api/security.js'

export default function SecurityPane() {
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void securityApi.getScanStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  async function rescanAll() {
    setBusy(true)
    try {
      await securityApi.rescanAll()
      const s = await securityApi.getScanStatus()
      setStatus(s)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <header className="flex items-center gap-2 mb-6">
        <ShieldAlert size={20} className="text-warm-accent dark:text-dark-accent" aria-hidden />
        <h2 className="text-lg font-medium text-warm-text dark:text-dark-text">Security</h2>
      </header>

      <section className="mb-6">
        <h3 className="text-sm font-medium text-warm-text dark:text-dark-text mb-2">Detector</h3>
        <p className="text-sm text-warm-muted dark:text-dark-muted mb-2">
          Active profile:{' '}
          <code className="font-mono text-xs">{status?.currentProfile ?? 'regex@3'}</code>
        </p>
        <button
          type="button"
          data-testid="settings-rescan-all"
          disabled={busy}
          onClick={() => { void rescanAll() }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm border border-warm-border dark:border-dark-border hover:bg-warm-surface dark:hover:bg-dark-surface disabled:opacity-60"
        >
          <RotateCw size={14} strokeWidth={1.75} aria-hidden />
          {busy ? 'Re-scanning…' : 'Rescan all sessions'}
        </button>
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-medium text-warm-text dark:text-dark-text mb-2">Enhanced detection (ML)</h3>
        <p className="text-sm text-warm-muted dark:text-dark-muted mb-3">
          Detects names, addresses, and other PII that pattern matching can't catch.
          Runs entirely on your device — no network requests for detection.
        </p>
        <div className="rounded border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface p-3 text-xs text-warm-muted dark:text-dark-muted">
          <div className="font-medium text-warm-text dark:text-dark-text mb-1">
            OpenAI Privacy Filter · ~800 MB · Apache 2.0
          </div>
          <div>Status: coming soon. The model download + WebGPU/WASM runtime ship in a follow-up release.</div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-warm-text dark:text-dark-text mb-2">Maintenance</h3>
        <p className="text-sm text-warm-muted dark:text-dark-muted">
          Old SQLite backups may still contain plaintext after a Purge. Backup management
          ships in a Phase 2 release alongside the encrypted-originals opt-in.
        </p>
      </section>
    </div>
  )
}
