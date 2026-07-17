// Identity surface for /me. Notion-style: clickable avatar +
// editable name in one row, save-on-blur, tiny text-link actions
// beneath. Mirrors the desktop SettingsAccount → ProfileEditor.

import { useEffect, useRef, useState } from 'react'

import {
  deleteAvatar,
  type MeResponse,
  updateDisplayName,
  uploadAvatar,
} from '../lib/api'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ACCEPT_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface Props {
  me: MeResponse
  onChanged: () => void
}

export function ProfileEditor({ me, onChanged }: Props) {
  const [draftName, setDraftName] = useState(me.display_name_override ?? '')
  const [savingName, setSavingName] = useState(false)
  const [busy, setBusy] = useState<'idle' | 'upload' | 'remove'>('idle')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDraftName(me.display_name_override ?? '')
    setError(null)
  }, [me.id, me.display_name_override])

  const persisted = me.display_name_override ?? ''

  async function commitName() {
    if (savingName) return
    const trimmed = draftName.trim()
    if (trimmed === persisted) return
    setSavingName(true)
    setError(null)
    try {
      await updateDisplayName(trimmed === '' ? null : trimmed)
      onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(messageForDisplayNameError(msg))
    } finally {
      setSavingName(false)
    }
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    if (file.size > MAX_AVATAR_BYTES) {
      setError('Image is too large (max 2 MB).')
      return
    }
    if (!ACCEPT_MIME.has(file.type)) {
      setError('Only PNG, JPEG, and WebP images are accepted.')
      return
    }
    setBusy('upload')
    try {
      await uploadAvatar(file)
      onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(messageForAvatarError(msg))
    } finally {
      setBusy('idle')
    }
  }

  async function handleRemoveCustom() {
    if (busy !== 'idle') return
    setBusy('remove')
    setError(null)
    try {
      await deleteAvatar()
      onChanged()
    } catch {
      setError("Couldn't remove avatar.")
    } finally {
      setBusy('idle')
    }
  }

  const hasCustom = !!me.custom_avatar_id
  const initial = computeInitial(me.display_name)

  return (
    <section className="sw-profile-editor">
      <div className="sw-profile-row">
        <div className="sw-avatar-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy === 'upload'}
            aria-label="Change profile photo"
            className="sw-avatar-btn"
          >
            {me.avatar_url ? (
              <img src={me.avatar_url} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="sw-avatar-initial">{initial}</span>
            )}
            <span className="sw-avatar-overlay" aria-hidden>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </span>
          </button>
          {hasCustom && (
            <button
              type="button"
              onClick={() => void handleRemoveCustom()}
              disabled={busy !== 'idle'}
              aria-label="Remove photo"
              className="sw-avatar-remove"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="sw-profile-body">
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            placeholder={me.display_name}
            maxLength={50}
            disabled={savingName}
            aria-label="Display name"
            className="sw-name-input"
          />
          {me.handle && <div className="sw-profile-meta">@{me.handle}</div>}
          {error && (
            <p role="alert" className="sw-error">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="sw-profile-email">
        <div className="sw-profile-email-label">Email</div>
        <div className="sw-profile-email-value sw-mono">{me.email}</div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sw-hidden"
        onChange={(e) => void handlePickFile(e)}
      />
    </section>
  )
}

function computeInitial(name: string): string {
  if (!name) return '?'
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const s of seg.segment(name)) return s.segment.toUpperCase()
  } catch {
    return name.charAt(0).toUpperCase()
  }
  return '?'
}

function messageForDisplayNameError(msg: string): string {
  if (msg.includes('too_long')) return 'Display name is too long (max 50 characters).'
  if (msg.includes('control_chars')) return "Display name contains characters that aren't allowed."
  return "Couldn't update display name."
}

function messageForAvatarError(msg: string): string {
  if (msg.includes('too large')) return 'Image is too large (max 2 MB).'
  if (msg.includes('unsupported') || msg.includes('malformed')) {
    return 'Only PNG, JPEG, and WebP images are accepted.'
  }
  return "Couldn't upload avatar."
}
