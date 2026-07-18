// The identity surface for Settings → Account. Notion-style:
// avatar + editable name in one row, save-on-blur, tiny contextual
// text-link actions beneath. Replaces the old "Profile" card +
// separate identity block.
//
// Avatar interaction:
//   - Click the circle → file picker (PNG/JPEG/WebP up to 2 MB).
//   - Hover/focus → "Change" overlay with camera glyph.
//   - When a custom avatar exists, a "Remove photo" link drops it.
//   - When the provider photo is visible, "Use initials" hides it.
//   - When the provider photo is hidden, "Use account photo" restores.

import { Camera, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useShareAuth } from '../hooks/useShareAuth.js'
import { resolveAvatarUrl } from '../lib/sharePublicUrl.js'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ACCEPT_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

export default function ProfileEditor() {
  const { t } = useTranslation()
  const { user, refresh } = useShareAuth()

  const [draftName, setDraftName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'idle' | 'upload' | 'remove'>('idle')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDraftName(user?.display_name_override ?? '')
    setNameError(null)
  }, [user?.id, user?.display_name_override])

  if (!user) return null

  const persisted = user.display_name_override ?? ''

  async function commitName() {
    if (savingName) return
    const trimmed = draftName.trim()
    if (trimmed === persisted) return
    setSavingName(true)
    setNameError(null)
    try {
      await window.spoolShare.updateDisplayName(trimmed === '' ? null : trimmed)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('too_long'))
        setNameError(t('settings.account.profile_displayName_error_tooLong'))
      else if (msg.includes('control_chars'))
        setNameError(t('settings.account.profile_displayName_error_controlChars'))
      else setNameError(t('settings.account.profile_displayName_error_generic'))
    } finally {
      setSavingName(false)
    }
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t('settings.account.profile_avatar_error_tooLarge'))
      return
    }
    if (!ACCEPT_MIME.has(file.type)) {
      toast.error(t('settings.account.profile_avatar_error_unsupported'))
      return
    }
    setBusy('upload')
    try {
      const buf = await file.arrayBuffer()
      await window.spoolShare.uploadAvatar(buf, file.type)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('too large'))
        toast.error(t('settings.account.profile_avatar_error_tooLarge'))
      else if (msg.includes('unsupported') || msg.includes('malformed')) {
        toast.error(t('settings.account.profile_avatar_error_unsupported'))
      } else {
        toast.error(t('settings.account.profile_avatar_error_generic'))
      }
    } finally {
      setBusy('idle')
    }
  }

  async function handleRemoveCustom() {
    if (busy !== 'idle') return
    setBusy('remove')
    try {
      await window.spoolShare.deleteAvatar()
      await refresh()
    } catch {
      toast.error(t('settings.account.profile_avatar_error_generic'))
    } finally {
      setBusy('idle')
    }
  }

  const hasCustom = !!user.custom_avatar_id
  const avatarSrc = user.avatar_url ? resolveAvatarUrl(user.avatar_url) : null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4">
        {/* `group` lives on the wrapper so the X badge (sibling of the
         *  avatar button) can show on hover of either, not just on
         *  hover of itself. */}
        <div className="group relative flex-none">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy === 'upload'}
            aria-label={t('settings.account.profile_avatar_change')}
            className="bg-warm-surface2 dark:bg-dark-surface2 focus-visible:ring-accent dark:focus-visible:ring-accent-dark relative block h-14 w-14 overflow-hidden rounded-full focus:outline-none focus-visible:ring-2 disabled:opacity-70"
          >
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="bg-accent dark:bg-accent-dark inline-flex h-full w-full items-center justify-center text-[18px] font-medium text-white">
                {computeInitials(user.display_name)}
              </span>
            )}
            <span className="absolute inset-0 inline-flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <Camera size={16} strokeWidth={1.75} className="text-white" aria-hidden />
            </span>
          </button>
          {/* Top-right close badge — hidden until the avatar block is
           *  hovered or focused, matching Notion's affordance. Only
           *  rendered when a custom avatar is set. */}
          {hasCustom && (
            <button
              type="button"
              onClick={() => void handleRemoveCustom()}
              disabled={busy !== 'idle'}
              aria-label={t('settings.account.profile_avatar_remove')}
              className="bg-warm-surface dark:bg-dark-surface2 border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:border-warm-border2 dark:hover:border-dark-border2 focus-visible:ring-accent dark:focus-visible:ring-accent-dark absolute -top-1 -right-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus:outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              <X size={11} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            placeholder={user.display_name}
            maxLength={50}
            disabled={savingName}
            aria-label={t('settings.account.profile_displayName_placeholder')}
            className="text-warm-text dark:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface focus:bg-warm-surface dark:focus:bg-dark-surface placeholder:text-warm-muted dark:placeholder:text-dark-muted -mx-2 block h-7 w-full rounded-md bg-transparent px-2 text-[15px] leading-[1.2] font-medium transition-colors focus:outline-none disabled:opacity-60"
          />
          {user.handle && (
            <div className="text-warm-muted dark:text-dark-muted truncate text-[12px] leading-tight">
              @{user.handle}
            </div>
          )}
          {nameError && (
            <p
              role="alert"
              className="mt-1 text-[11.5px] text-[color:var(--color-status-error)] dark:text-[color:var(--color-status-error-dark)]"
            >
              {nameError}
            </p>
          )}
        </div>
      </div>

      {/* Email — read-only labeled row. Sign-in identity, not editable
       *  here (would require an OAuth-side change). */}
      <div>
        <div className="text-warm-faint dark:text-dark-muted text-[11.5px]">
          {t('settings.account.profile_emailLabel')}
        </div>
        <div className="text-warm-muted dark:text-dark-muted mt-0.5 truncate font-mono text-[12.5px]">
          {user.email}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void handlePickFile(e)}
      />
    </section>
  )
}

function computeInitials(name: string): string {
  if (!name) return '?'
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const s of seg.segment(name)) return s.segment.toUpperCase()
  } catch {
    return name.charAt(0).toUpperCase()
  }
  return '?'
}
