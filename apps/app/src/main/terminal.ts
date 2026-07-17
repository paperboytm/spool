/**
 * Terminal detection and command execution for session resume.
 *
 * Strategy:
 *   1. If the user has configured a preferred terminal in settings, use that.
 *   2. Otherwise, check which third-party terminal is currently running via
 *      AppleScript. If the user has Warp / iTerm / etc. open, that's what
 *      they use daily.
 *   3. If no known third-party terminal is running, fall back to Terminal.app.
 *      This guarantees the resume command always runs — opening the "wrong"
 *      terminal is acceptable; silently dropping the command is not.
 *
 * Per-terminal execution methods:
 *   - Terminal.app / iTerm2: AppleScript (official scripting dictionaries)
 *   - Kitty / Alacritty / WezTerm: CLI arguments (designed for this)
 *   - Warp: Launch Configurations + warp:// URI scheme (official API,
 *     see https://docs.warp.dev/terminal/sessions/launch-configurations)
 *
 * Detection result is cached for the lifetime of the process since the user's
 * terminal choice doesn't change mid-session.
 */

// execSync only fires when the user clicks "Resume in terminal", a
// deliberate user gesture long after launch. Not on the cold-launch path.
// eslint-disable-next-line no-restricted-imports
import { execSync, spawn } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { shell } from 'electron'

const IS_LINUX = process.platform === 'linux'

/**
 * Terminal identifiers. These double as the display names shown in settings
 * and the keys used in the runners map.
 */
export const SUPPORTED_TERMINALS = ['Terminal', 'iTerm2', 'Warp', 'Ghostty', 'kitty', 'Alacritty', 'WezTerm'] as const
export type SupportedTerminal = (typeof SUPPORTED_TERMINALS)[number]

// Third-party terminals to probe, in order of popularity. New entries are
// appended at the end so adding a terminal never changes which one an
// existing user (with several running and no explicit preference) auto-detects.
const THIRD_PARTY: SupportedTerminal[] = ['iTerm2', 'Warp', 'kitty', 'Alacritty', 'WezTerm', 'Ghostty']

let autoDetectedTerminal: SupportedTerminal | undefined

/**
 * Auto-detect by checking which terminal app is currently running.
 * Third-party terminals are checked first — if the user installed and is
 * running one, they almost certainly prefer it over the built-in Terminal.app.
 */
function autoDetect(): SupportedTerminal {
  if (autoDetectedTerminal !== undefined) return autoDetectedTerminal

  for (const name of THIRD_PARTY) {
    try {
      const running = execSync(
        `osascript -e 'application "${name}" is running'`,
        { timeout: 2000 },
      ).toString().trim()
      if (running === 'true') {
        autoDetectedTerminal = name
        return autoDetectedTerminal
      }
    } catch { /* app not installed or osascript failed — skip */ }
  }

  autoDetectedTerminal = 'Terminal'
  return autoDetectedTerminal
}

/** Prepend `cd '<cwd>' &&` to a command if cwd is provided. */
function withCwd(cmd: string, cwd?: string): string {
  return cwd ? `cd ${shellQuote(cwd)} && ${cmd}` : cmd
}

/**
 * Build the single `sh -c` argument for the `open --args` runners: run the
 * command (in cwd) and keep the window alive with `exec $SHELL`. The whole
 * payload is shell-quoted as one token so the outer shell (execSync) can't
 * split it — otherwise a cwd or command containing a space (e.g. a project
 * path like "/Users/x/My Project") or a single quote breaks apart the
 * argument and the resume command is silently dropped.
 */
function keepAliveArg(cmd: string, cwd?: string): string {
  return shellQuote(`${withCwd(cmd, cwd)}; exec $SHELL`)
}

import { shellQuote } from '../shared/resumeCommand.js'

/**
 * Per-terminal command runners. Each takes a shell command string and an
 * optional cwd, then opens a new terminal window/tab to execute it.
 */
const runners: Record<SupportedTerminal, (cmd: string, cwd?: string) => void> = {
  // Terminal.app — AppleScript `do script`
  'Terminal': (cmd, cwd) => {
    execSync(`osascript -e 'tell application "Terminal" to do script "${withCwd(cmd, cwd)}"'`)
  },

  // iTerm2 — AppleScript `create window with default profile command`
  'iTerm2': (cmd, cwd) => {
    const full = withCwd(cmd, cwd)
    const script = `tell application "iTerm2"
      activate
      set w to (create window with default profile command "${full}")
    end tell`
    execSync(`osascript -e '${script}'`)
  },

  // Warp — uses Launch Configurations (official API). We write a fixed-name YAML
  // config to ~/.warp/launch_configurations/ and open it via warp:// URI scheme.
  // Docs: https://docs.warp.dev/terminal/sessions/launch-configurations
  'Warp': (cmd, cwd) => {
    const configDir = join(homedir(), '.warp', 'launch_configurations')
    const configName = `spool-resume-${Date.now()}`
    const configPath = join(configDir, `${configName}.yaml`)

    mkdirSync(configDir, { recursive: true })

    // Clean up stale spool-resume-* configs from previous runs
    for (const f of readdirSync(configDir)) {
      if (f.startsWith('spool-resume-')) {
        try { unlinkSync(join(configDir, f)) } catch {}
      }
    }

    writeFileSync(configPath, `---
name: ${configName}
windows:
  - tabs:
      - title: Session Resume
        layout:
          cwd: "${cwd || homedir()}"
          commands:
            - exec: ${cmd}
`)
    void shell.openExternal(`warp://launch/${configName}`).catch((error) => {
      console.error('[terminal] failed to open Warp launch configuration:', error)
    })
  },

  // Ghostty — macOS has no direct CLI, so pass args through `open --args`.
  // `-e` runs the command; `exec $SHELL` keeps the window alive afterwards.
  'Ghostty': (cmd, cwd) => {
    execSync(`open -a Ghostty --args -e sh -c ${keepAliveArg(cmd, cwd)}`)
  },

  // Kitty — `open --args`; `exec $SHELL` keeps the window alive
  'kitty': (cmd, cwd) => {
    execSync(`open -a kitty --args sh -c ${keepAliveArg(cmd, cwd)}`)
  },

  // Alacritty — uses `-e` flag for command execution
  'Alacritty': (cmd, cwd) => {
    execSync(`open -a Alacritty --args -e sh -c ${keepAliveArg(cmd, cwd)}`)
  },

  // WezTerm — `start --` separates wezterm args from the spawned command
  'WezTerm': (cmd, cwd) => {
    execSync(`open -a WezTerm --args start -- sh -c ${keepAliveArg(cmd, cwd)}`)
  },
}

/** App bundle paths for installation checks. Terminal.app is always present. */
const APP_PATHS: Record<SupportedTerminal, string> = {
  'Terminal': '/System/Applications/Utilities/Terminal.app',
  'iTerm2': '/Applications/iTerm.app',
  'Warp': '/Applications/Warp.app',
  'Ghostty': '/Applications/Ghostty.app',
  'kitty': '/Applications/kitty.app',
  'Alacritty': '/Applications/Alacritty.app',
  'WezTerm': '/Applications/WezTerm.app',
}

function isInstalled(terminal: SupportedTerminal): boolean {
  return existsSync(APP_PATHS[terminal])
}

/**
 * Resolve which terminal to use: user preference > auto-detection > Terminal.app.
 * If the user picked a terminal that isn't installed, fall back gracefully.
 */
function resolve(preference?: string): SupportedTerminal {
  if (preference && preference in runners) {
    const pref = preference as SupportedTerminal
    if (isInstalled(pref)) return pref
  }
  return autoDetect()
}

/**
 * Open a terminal and execute a command for session resume.
 * @param command  Shell command to run, or null to just activate the terminal.
 * @param preference  User-configured terminal name from settings (optional).
 * @param cwd  Working directory to open the terminal in (optional).
 */
export function openTerminal(command: string | null, preference?: string, cwd?: string): void {
  const resolvedCwd = cwd?.replace(/^~/, homedir())

  if (IS_LINUX) {
    if (!command) return
    // xdg-terminal-exec is the freedesktop standard for launching the user's
    // preferred terminal emulator. Pass the command via sh -c so it works
    // regardless of which terminal is configured.
    const args = ['sh', '-c', withCwd(command, resolvedCwd)]
    spawn('xdg-terminal-exec', args, { stdio: 'ignore', detached: true }).unref()
    return
  }

  const terminal = resolve(preference)

  if (!command) {
    execSync(`osascript -e 'tell application "${terminal}" to activate'`)
    return
  }

  runners[terminal](command, resolvedCwd)
}
