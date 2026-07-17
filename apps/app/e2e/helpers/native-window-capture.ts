/**
 * macOS-only helpers for capturing the Spool Electron window as a real OS window
 * (with traffic lights, rounded corners, shadow — not the WebContents-only
 * renderer screenshot Playwright produces by default).
 *
 * Used by ad-hoc release-video recording scripts. Not part of the regular
 * e2e suite. Requires `swift` and `screencapture` on PATH (Xcode CLT).
 */
import type { ElectronApplication } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

export interface NativeWindowInfo {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Find the Quartz window-id that corresponds to the Electron app's
 * front-most BrowserWindow. We use the Electron pid + bounds reported by
 * `BrowserWindow.getBounds()` to disambiguate when multiple windows exist.
 */
export async function nativeWindowInfo(app: ElectronApplication): Promise<NativeWindowInfo> {
  const meta = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No Electron window found')
    const bounds = win.getBounds()
    return {
      pid: process.pid,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    }
  })

  const swiftScript = `
import CoreGraphics
import Foundation

let targetPid = Int(CommandLine.arguments[1])!
let targetWidth = Int(CommandLine.arguments[2])!
let targetHeight = Int(CommandLine.arguments[3])!
let targetX = Int(CommandLine.arguments[4])!
let targetY = Int(CommandLine.arguments[5])!

let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

struct Candidate {
  let id: Int
  let score: Int
  let x: Int
  let y: Int
  let width: Int
  let height: Int
}

func number(_ any: Any?) -> Int? {
  if let n = any as? NSNumber { return n.intValue }
  if let n = any as? Int { return n }
  return nil
}

var best: Candidate?

for item in list {
  guard number(item["kCGWindowOwnerPID"]) == targetPid else { continue }
  guard number(item["kCGWindowLayer"]) == 0 else { continue }
  guard let bounds = item["kCGWindowBounds"] as? [String: Any] else { continue }
  guard let width = number(bounds["Width"]),
        let height = number(bounds["Height"]),
        let x = number(bounds["X"]),
        let y = number(bounds["Y"]),
        let windowId = number(item["kCGWindowNumber"]) else { continue }

  let score = abs(width - targetWidth) + abs(height - targetHeight) + abs(x - targetX) + abs(y - targetY)
  if best == nil || score < best!.score {
    best = Candidate(id: windowId, score: score, x: x, y: y, width: width, height: height)
  }
}

if let best {
  print("{\\"id\\":\\"\\(best.id)\\",\\"x\\":\\(best.x),\\"y\\":\\(best.y),\\"width\\":\\(best.width),\\"height\\":\\(best.height)}")
} else {
  fputs("No matching Quartz window found\\n", stderr)
  Foundation.exit(1)
}
`

  const raw = execFileSync('swift', [
    '-e',
    swiftScript,
    String(meta.pid),
    String(meta.width),
    String(meta.height),
    String(meta.x),
    String(meta.y),
  ], { encoding: 'utf8' }).trim()

  return JSON.parse(raw) as NativeWindowInfo
}

/**
 * Capture a single PNG of the native window (includes traffic lights + rounded
 * corners + shadow). Output path is created if missing.
 */
export async function captureNativeWindow(app: ElectronApplication, outputPath: string): Promise<void> {
  await app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No Electron window found')
    win.show()
    win.focus()
    electronApp.focus({ steal: true })
  })

  const info = await nativeWindowInfo(app)
  mkdirSync(dirname(outputPath), { recursive: true })
  execFileSync('screencapture', ['-x', '-l', info.id, outputPath])
}

/**
 * Record the native window to .mov for the given duration. The `perform`
 * callback runs concurrently with the recording — use it to drive the app
 * through the interactions you want filmed. Returns when screencapture exits.
 *
 * Note: macOS `screencapture -V` records the rectangle area (which we set to
 * the exact native window bounds). The system cursor is NOT included; if you
 * want a cursor in frame, add `-C` to the args.
 */
export async function recordNativeWindow(
  app: ElectronApplication,
  outputPath: string,
  seconds: number,
  perform: () => Promise<void>,
): Promise<void> {
  await app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No Electron window found')
    win.show()
    win.focus()
    electronApp.focus({ steal: true })
  })

  const info = await nativeWindowInfo(app)
  mkdirSync(dirname(outputPath), { recursive: true })
  rmSync(outputPath, { force: true })

  const rect = `${info.x},${info.y},${info.width},${info.height}`
  const proc = spawn('screencapture', ['-x', '-V', String(seconds), '-R', rect, outputPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await perform()

  await new Promise<void>((resolve, reject) => {
    let stderr = ''
    proc.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })
    proc.on('close', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`screencapture failed (${code}): ${stderr.trim()}`))
    })
    proc.on('error', reject)
  })
}
