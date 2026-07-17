import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Auto-updater for packaged (production) builds.
 * Follows VS Code pattern: notify → user approves → download → restart.
 *
 * - Only runs when app.isPackaged is true (skips `pnpm dev`)
 * - Checks GitHub Releases on startup (10s delay) then every 4 hours
 * - Does NOT auto-download or auto-install
 * - Notifies renderer when update is available; user decides when to download
 */

const CHECK_INTERVAL = 4 * 60 * 60 * 1000 // 4 hours

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for update...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: ${info.version}`)
    getMainWindow()?.webContents.send('spool:update-status', {
      status: 'available',
      version: info.version,
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] No update available')
  })

  autoUpdater.on('download-progress', (progress) => {
    getMainWindow()?.webContents.send('spool:update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: ${info.version}`)
    getMainWindow()?.webContents.send('spool:update-status', {
      status: 'ready',
      version: info.version,
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message)
    // Clear any downloading state so the UI doesn't get stuck
    getMainWindow()?.webContents.send('spool:update-status', { status: 'error' })
  })

  // First check after 10s delay, then every CHECK_INTERVAL.
  // Track last check time to avoid duplicate checks after macOS sleep/wake.
  let lastCheckAt = 0

  const doCheck = () => {
    const now = Date.now()
    if (now - lastCheckAt < CHECK_INTERVAL * 0.9) return // debounce
    lastCheckAt = now
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Check failed:', err.message)
    })
  }

  setTimeout(doCheck, 10_000)
  setInterval(doCheck, CHECK_INTERVAL)
}

/** User approved — start downloading the update */
export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('[updater] Download failed:', err.message)
  })
}

/** Download complete — quit and install */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
