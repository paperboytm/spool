// Identity surface for /me. Notion-style: clickable avatar +
// editable name in one row, save-on-blur, tiny text-link actions
// beneath. Mirrors the desktop SettingsAccount → ProfileEditor.

import { Avatar, IconButton } from '@spool-lab/ui'
import { Camera, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { deleteAvatar, type MeResponse, updateDisplayName, uploadAvatar } from '../lib/api'

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
            <Avatar src={me.avatar_url} name={me.display_name} alt="" size="lg" />
            <span className="sw-avatar-overlay" aria-hidden>
              <Camera size={16} strokeWidth={1.75} />
            </span>
          </button>
          {hasCustom && (
            <IconButton
              size="sm"
              type="button"
              onClick={() => void handleRemoveCustom()}
              disabled={busy !== 'idle'}
              aria-label="Remove photo"
              className="sw-avatar-remove"
            >
              <X size={11} strokeWidth={2.4} aria-hidden="true" />
            </IconButton>
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
