import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'

let tray: Tray | null = null

export function setupTray(
  onShow: () => void,
  onSync: () => void,
): void {
  // Template image — macOS auto-handles light/dark tint.
  // File named *Template* so Electron marks it as template automatically.
  const iconPath = join(__dirname, '../../resources/tray-iconTemplate.png')
  let icon: ReturnType<typeof nativeImage.createFromPath>
  try {
    icon = nativeImage.createFromPath(iconPath)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Spool — search your thinking')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Spool', click: onShow },
    { type: 'separator' },
    { label: 'Sync Now', click: onSync },
    { type: 'separator' },
    { label: 'Quit Spool', click: () => app.quit() },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', onShow)
}
