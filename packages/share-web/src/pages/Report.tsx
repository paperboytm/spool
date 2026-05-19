import { useState, type FormEvent } from 'react'

import { submitReport, type ReportPayload, type ReportReason, type ReportResult } from '../lib/api'

interface Props {
  initialId: string | null
}

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'csam', label: 'Child sexual abuse material (CSAM)' },
  { id: 'doxx', label: 'Personal information / doxxing' },
  { id: 'harassment', label: 'Harassment or threats' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'spam', label: 'Spam or scam' },
  { id: 'other', label: 'Something else' },
]

const MAX_NOTE = 1000

export function Report({ initialId }: Props) {
  const [id, setId] = useState(initialId ?? '')
  const [reason, setReason] = useState<ReportReason>('other')
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReportResult | null>(null)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    if (!/^[A-Za-z0-9_-]{21}$/.test(id)) {
      setResult({ kind: 'invalid', message: 'Please paste a full spool.share link or 21-character share ID.' })
      return
    }
    setBusy(true)
    setResult(null)
    const payload: ReportPayload = { id, reason }
    const trimmedNote = note.slice(0, MAX_NOTE)
    if (trimmedNote) payload.note = trimmedNote
    const trimmedEmail = email.trim()
    if (trimmedEmail) payload.email = trimmedEmail
    submitReport(payload)
      .then((r) => setResult(r))
      .finally(() => setBusy(false))
  }

  if (result?.kind === 'ok') {
    return (
      <main className="report-page">
        <div className="report-card">
          <h1>Thanks — report received.</h1>
          <p>
            We log every report and review CSAM and doxxing reports first. You won’t hear back
            unless we need more detail.
          </p>
          <p>
            <a href="/">Return home</a>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="report-page">
      <div className="report-card">
        <h1>Report a share</h1>
        <p className="report-lede">
          Tell us what’s wrong with this share. We act fastest on CSAM and doxxing.
        </p>
        <form onSubmit={onSubmit} noValidate>
          <label className="report-field">
            <span>Share ID</span>
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              required
              value={id}
              onChange={(e) => setId(e.target.value.trim())}
              placeholder="e.g. K7s4F3pQz1mB9XnLrV8aE"
              aria-describedby="report-id-hint"
            />
            <small id="report-id-hint">The 21-character ID at the end of a /s/&lt;id&gt; link.</small>
          </label>

          <fieldset className="report-field">
            <legend>Reason</legend>
            {REASONS.map((r) => (
              <label key={r.id} className="report-reason">
                <input
                  type="radio"
                  name="reason"
                  value={r.id}
                  checked={reason === r.id}
                  onChange={() => setReason(r.id)}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>

          <label className="report-field">
            <span>Details (optional)</span>
            <textarea
              rows={5}
              maxLength={MAX_NOTE}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should we know?"
            />
            <small>{note.length}/{MAX_NOTE}</small>
          </label>

          <label className="report-field">
            <span>Your email (optional)</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Only if you want a reply"
            />
          </label>

          {result?.kind === 'invalid' && (
            <p className="report-error" role="alert">{result.message}</p>
          )}
          {result?.kind === 'rate-limited' && (
            <p className="report-error" role="alert">
              You’ve sent several reports recently — please wait a few minutes and try again.
            </p>
          )}
          {result?.kind === 'error' && (
            <p className="report-error" role="alert">
              Something went wrong sending the report. Try again in a moment.
            </p>
          )}

          <div className="report-actions">
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
            <a href="/" className="report-cancel">Cancel</a>
          </div>
        </form>
      </div>
    </main>
  )
}
