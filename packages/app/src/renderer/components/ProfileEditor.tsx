// Display-name override + avatar upload card. Embedded inside
// SettingsAccount. The server is the source of truth (we read the
// resolved values off useShareAuth.user); local form state only
// carries what the user is currently editing.
//
// Avatar:
//   - File picker (HTML <input type="file">) accepts PNG/JPEG/WebP
//     up to 1 MB. We do client-side checks before sending so a bad
//     file fails fast without a backend round-trip.
//   - Upload streams the bytes to main via IPC as ArrayBuffer; main
//     builds the multipart Blob + POSTs to /api/me/avatar.
//   - "Show provider picture" toggle: hides the Google avatar without
//     uploading a custom one. Useful for privacy without committing
//     to an image.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Trash2, Upload } from 'lucide-react'

import { useShareAuth } from '../hooks/useShareAuth.js'

const MAX_AVATAR_BYTES = 1 * 1024 * 1024
const ACCEPT_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

export default function ProfileEditor() {
  const { t } = useTranslation()
  const { user, refresh } = useShareAuth()

  const [draftName, setDraftName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [savingVisible, setSavingVisible] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Seed the input from the server's `display_name_override` so the
  // form reflects what the user actually typed, not the resolved
  // value (which may be the provider name). Re-seed on identity
  // change so a sign-out/sign-in doesn't carry a stale draft across.
  useEffect(() => {
    setDraftName(user?.display_name_override ?? '')
  }, [user?.id, user?.display_name_override])

  if (!user) return null

  const nameDirty = (user.display_name_override ?? '') !== draftName.trim()

  async function handleSaveName() {
    if (savingName) return
    setSavingName(true)
    try {
      const trimmed = draftName.trim()
      // Empty = clear override (back to provider name).
      const value = trimmed === '' ? null : trimmed
      await window.spoolShare.updateDisplayName(value)
      await refresh()
      toast.success(t('settings.account.profile_displayName_savedToast'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('too_long')) {
        toast.error(t('settings.account.profile_displayName_error_tooLong'))
      } else if (msg.includes('control_chars')) {
        toast.error(t('settings.account.profile_displayName_error_controlChars'))
      } else {
        toast.error(t('settings.account.profile_displayName_error_generic'))
      }
    } finally {
      setSavingName(false)
    }
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t('settings.account.profile_avatar_error_tooLarge'))
      return
    }
    if (!ACCEPT_MIME.has(file.type)) {
      toast.error(t('settings.account.profile_avatar_error_unsupported'))
      return
    }
    setUploading(true)
    try {
      const buf = await file.arrayBuffer()
      await window.spoolShare.uploadAvatar(buf, file.type)
      await refresh()
      toast.success(t('settings.account.profile_avatar_uploadedToast'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('too large')) {
        toast.error(t('settings.account.profile_avatar_error_tooLarge'))
      } else if (msg.includes('unsupported') || msg.includes('malformed')) {
        toast.error(t('settings.account.profile_avatar_error_unsupported'))
      } else {
        toast.error(t('settings.account.profile_avatar_error_generic'))
      }
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveCustomAvatar() {
    if (removing) return
    setRemoving(true)
    try {
      await window.spoolShare.deleteAvatar()
      await refresh()
      toast.success(t('settings.account.profile_avatar_removedToast'))
    } catch {
      toast.error(t('settings.account.profile_avatar_error_generic'))
    } finally {
      setRemoving(false)
    }
  }

  async function handleToggleVisible(next: boolean) {
    if (savingVisible) return
    setSavingVisible(true)
    try {
      await window.spoolShare.setAvatarVisible(next)
      await refresh()
    } catch {
      // Silent rollback: the toggle will revert on next refresh.
    } finally {
      setSavingVisible(false)
    }
  }

  const initials = computeInitials(user.display_name)
  const hasCustomAvatar = !!user.custom_avatar_id
  const showProviderToggle = !hasCustomAvatar && !!user.name

  return (
    <section className="space-y-6">
      <h3 className="text-[14px] font-medium text-warm-text dark:text-dark-text">
        {t('settings.account.profile_title')}
      </h3>

      {/* Display name */}
      <div className="space-y-2">
        <label htmlFor="profile-display-name" className="text-[12px] font-medium text-warm-text dark:text-dark-text">
          {t('settings.account.profile_displayName_label')}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="profile-display-name"
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t('settings.account.profile_displayName_placeholder')}
            maxLength={50}
            className="flex-1 h-8 px-2.5 rounded-md border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg text-[13px] text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-muted focus:outline-none focus:border-accent dark:focus:border-accent-dark"
          />
          <button
            type="button"
            onClick={() => void handleSaveName()}
            disabled={savingName || !nameDirty}
            className="h-8 px-3 rounded-md text-[12px] font-medium text-white bg-accent dark:bg-accent-dark hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingName
              ? t('settings.account.profile_displayName_saving')
              : t('settings.account.profile_displayName_save')}
          </button>
        </div>
        <p className="text-[11.5px] text-warm-muted dark:text-dark-muted">
          {t('settings.account.profile_displayName_help')}
        </p>
      </div>

      {/* Avatar */}
      <div className="space-y-2">
        <label className="text-[12px] font-medium text-warm-text dark:text-dark-text">
          {t('settings.account.profile_avatar_title')}
        </label>
        <div className="flex items-start gap-3">
          {/* Preview */}
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="w-16 h-16 rounded-full object-cover border border-warm-border dark:border-dark-border"
            />
          ) : (
            <div
              role="img"
              aria-label={t('settings.account.profile_avatar_initialsAlt')}
              className="w-16 h-16 rounded-full inline-flex items-center justify-center text-[18px] font-medium text-white bg-accent dark:bg-accent-dark"
            >
              {initials}
            </div>
          )}

          <div className="flex-1 space-y-2">
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-warm-text dark:text-dark-text border border-warm-border dark:border-dark-border hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors disabled:opacity-50"
              >
                <Upload size={12} strokeWidth={1.75} aria-hidden />
                {uploading
                  ? t('settings.account.profile_avatar_uploading')
                  : t('settings.account.profile_avatar_uploadButton')}
              </button>
              {hasCustomAvatar && (
                <button
                  type="button"
                  onClick={() => void handleRemoveCustomAvatar()}
                  disabled={removing}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)] border border-[color:var(--color-status-error)]/30 hover:bg-[color:var(--color-status-error)]/8 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={12} strokeWidth={1.75} aria-hidden />
                  {removing
                    ? t('settings.account.profile_avatar_removing')
                    : t('settings.account.profile_avatar_removeButton')}
                </button>
              )}
            </div>
            <p className="text-[11.5px] text-warm-muted dark:text-dark-muted">
              {t('settings.account.profile_avatar_help')}
            </p>

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void handlePickFile(e)}
            />

            {showProviderToggle && (
              <label className="flex items-start gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={user.avatar_visible}
                  onChange={(e) => void handleToggleVisible(e.target.checked)}
                  disabled={savingVisible}
                  className="mt-0.5 accent-accent dark:accent-accent-dark"
                />
                <span className="flex-1">
                  <span className="block text-[12px] text-warm-text dark:text-dark-text">
                    {t('settings.account.profile_avatar_showGoogle')}
                  </span>
                  <span className="block text-[11.5px] text-warm-muted dark:text-dark-muted">
                    {t('settings.account.profile_avatar_showGoogleHelp')}
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

/** Take the first grapheme of the resolved display name as the
 *  initial circle's content. Intl.Segmenter handles emoji + CJK
 *  correctly (a single rendered glyph, not a surrogate pair). */
function computeInitials(name: string): string {
  if (!name) return '?'
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const s of seg.segment(name)) return s.segment.toUpperCase()
  } catch {
    // Older runtime — fall back to code-unit slice.
    return name.charAt(0).toUpperCase()
  }
  return '?'
}
