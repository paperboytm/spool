import { spawnSync } from 'node:child_process'

interface ClipboardCommand {
  command: string
  args: string[]
}

/** Best-effort native clipboard write without invoking a shell. */
export function copyTextToClipboard(text: string): boolean {
  for (const { command, args } of clipboardCommands(process.platform)) {
    const result = spawnSync(command, args, {
      input: text,
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 2_000,
      windowsHide: true,
    })
    if (result.status === 0) return true
  }
  return false
}

function clipboardCommands(platform: NodeJS.Platform): ClipboardCommand[] {
  switch (platform) {
    case 'darwin':
      return [{ command: 'pbcopy', args: [] }]
    case 'win32':
      return [{ command: 'clip.exe', args: [] }]
    default:
      return [
        { command: 'wl-copy', args: [] },
        { command: 'xclip', args: ['-selection', 'clipboard'] },
        { command: 'xsel', args: ['--clipboard', '--input'] },
        // Available from Linux processes running under WSL.
        { command: 'clip.exe', args: [] },
      ]
  }
}
