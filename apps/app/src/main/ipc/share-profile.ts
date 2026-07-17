// IPC bridge for the user profile customization endpoints:
//   - share-profile:update-display-name → PATCH /api/me/profile
//   - share-profile:set-avatar-visible  → PATCH /api/me/profile
//   - share-profile:upload-avatar       → POST  /api/me/avatar (multipart)
//   - share-profile:delete-avatar       → DELETE /api/me/avatar
//
// Renderer sends bytes for the avatar upload as an ArrayBuffer over
// IPC; main reconstructs a multipart FormData with a Blob and POSTs
// to the backend. Keeping the multipart-construction here (not in the
// renderer) means the renderer never has to know about Blob/FormData
// quirks across the Electron context boundary.

import { ipcMain } from 'electron'

import { authedFetch } from '../share/api-client.js'

interface ProfileUpdateResponse {
  ok: true
  changed: number
}
interface AvatarUploadResponse {
  avatar_id: string
  url: string
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string; error?: string }
    return body.detail ?? body.error ?? `HTTP_${res.status}`
  } catch {
    return `HTTP_${res.status}`
  }
}

export function registerShareProfileIpc(): void {
  ipcMain.handle(
    'share-profile:update-display-name',
    async (_e, value: string | null): Promise<ProfileUpdateResponse> => {
      const r = await authedFetch('/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ display_name: value }),
      })
      if (!r.ok) throw new Error(await readErrorDetail(r))
      return (await r.json()) as ProfileUpdateResponse
    },
  )

  ipcMain.handle(
    'share-profile:set-avatar-visible',
    async (_e, visible: boolean): Promise<ProfileUpdateResponse> => {
      const r = await authedFetch('/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ avatar_visible: visible }),
      })
      if (!r.ok) throw new Error(await readErrorDetail(r))
      return (await r.json()) as ProfileUpdateResponse
    },
  )

  ipcMain.handle(
    'share-profile:upload-avatar',
    async (_e, bytes: ArrayBuffer, mime: string): Promise<AvatarUploadResponse> => {
      // multipart/form-data with a single "avatar" file field. Build
      // it here in main rather than in the renderer because Blob/File
      // serialization across the Electron context bridge is fragile —
      // ArrayBuffer round-trips cleanly.
      const form = new FormData()
      const blob = new Blob([bytes], { type: mime })
      form.append('avatar', blob, 'avatar.bin')
      console.log(
        `[share-profile] upload-avatar: bytes=${bytes.byteLength} mime=${mime} blob.size=${blob.size}`,
      )
      const r = await authedFetch('/api/me/avatar', {
        method: 'POST',
        body: form,
      })
      if (!r.ok) {
        const detail = await readErrorDetail(r)
        console.error(
          `[share-profile] upload-avatar failed: status=${r.status} detail=${detail}`,
        )
        throw new Error(detail)
      }
      return (await r.json()) as AvatarUploadResponse
    },
  )

  ipcMain.handle('share-profile:delete-avatar', async (): Promise<{ ok: true }> => {
    const r = await authedFetch('/api/me/avatar', { method: 'DELETE' })
    if (!r.ok) throw new Error(await readErrorDetail(r))
    return { ok: true }
  })
}
