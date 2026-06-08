// Display name + avatar editor for the /me page. Mirrors the desktop
// SettingsAccount ProfileEditor — same backend endpoints, just a
// different host. Reuses the existing Avatar component for the
// preview so the visual matches the rest of /me.

import { useEffect, useRef, useState } from 'react'

import {
  deleteAvatar,
  type MeResponse,
  setAvatarVisible,
  updateDisplayName,
  uploadAvatar,
} from '../lib/api'
import { Avatar } from './Chrome'

const MAX_AVATAR_BYTES = 1 * 1024 * 1024
const ACCEPT_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface Props {
  me: MeResponse
  onChanged: () => void
}

export function ProfileEditor({ me, onChanged }: Props) {
  const [draftName, setDraftName] = useState(me.display_name_override ?? '')
  const [savingName, setSavingName] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [savingVisible, setSavingVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDraftName(me.display_name_override ?? '')
  }, [me.id, me.display_name_override])

  const nameDirty = (me.display_name_override ?? '') !== draftName.trim()

  async function handleSaveName() {
    if (savingName) return
    setSavingName(true)
    setError(null)
    try {
      const trimmed = draftName.trim()
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
      setError('Image is too large (max 1 MB).')
      return
    }
    if (!ACCEPT_MIME.has(file.type)) {
      setError('Only PNG, JPEG, and WebP images are accepted.')
      return
    }
    setUploading(true)
    try {
      await uploadAvatar(file)
      onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(messageForAvatarError(msg))
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    if (removing) return
    setRemoving(true)
    setError(null)
    try {
      await deleteAvatar()
      onChanged()
    } catch {
      setError("Couldn't remove avatar.")
    } finally {
      setRemoving(false)
    }
  }

  async function handleToggleVisible(next: boolean) {
    if (savingVisible) return
    setSavingVisible(true)
    setError(null)
    try {
      await setAvatarVisible(next)
      onChanged()
    } catch {
      // Silent: next refresh re-syncs.
    } finally {
      setSavingVisible(false)
    }
  }

  const hasCustomAvatar = !!me.custom_avatar_id
  const showProviderToggle = !hasCustomAvatar && !!me.name

  return (
    <div className="sw-profile-editor">
      {/* Display name */}
      <div className="sw-form-row">
        <label htmlFor="me-display-name" className="sw-label">
          Display name
        </label>
        <div className="sw-input-row">
          <input
            id="me-display-name"
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="How others see you"
            maxLength={50}
            className="sw-input"
          />
          <button
            type="button"
            onClick={() => void handleSaveName()}
            disabled={savingName || !nameDirty}
            className="sw-btn sw-btn-primary sw-btn-sm"
          >
            {savingName ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="sw-hint">
          Overrides the name from your sign-in provider. Leave empty to use it.
        </p>
      </div>

      {/* Avatar */}
      <div className="sw-form-row">
        <label className="sw-label">Avatar</label>
        <div className="sw-avatar-row">
          <Avatar src={me.avatar_url} name={me.display_name} size={64} />
          <div className="sw-avatar-actions">
            <div className="sw-btn-row">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="sw-btn sw-btn-ghost sw-btn-sm"
              >
                {uploading ? 'Uploading…' : 'Upload image'}
              </button>
              {hasCustomAvatar && (
                <button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={removing}
                  className="sw-btn sw-btn-danger sw-btn-sm"
                >
                  {removing ? 'Removing…' : 'Remove custom avatar'}
                </button>
              )}
            </div>
            <p className="sw-hint">
              PNG, JPEG, or WebP up to 1 MB. We strip EXIF metadata before storing.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sw-hidden"
              onChange={(e) => void handlePickFile(e)}
            />
            {showProviderToggle && (
              <label className="sw-toggle">
                <input
                  type="checkbox"
                  checked={me.avatar_visible}
                  onChange={(e) => void handleToggleVisible(e.target.checked)}
                  disabled={savingVisible}
                />
                <span>
                  <span className="sw-toggle-title">
                    Show my sign-in provider&apos;s profile picture
                  </span>
                  <span className="sw-toggle-sub">
                    Turn this off to use your initials instead.
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="sw-error">
          {error}
        </p>
      )}
    </div>
  )
}

function messageForDisplayNameError(msg: string): string {
  if (msg.includes('too_long')) return 'Display name is too long (max 50 characters).'
  if (msg.includes('control_chars')) return "Display name contains characters that aren't allowed."
  return "Couldn't update display name."
}

function messageForAvatarError(msg: string): string {
  if (msg.includes('too large')) return 'Image is too large (max 1 MB).'
  if (msg.includes('unsupported') || msg.includes('malformed')) {
    return 'Only PNG, JPEG, and WebP images are accepted.'
  }
  return "Couldn't upload avatar."
}
