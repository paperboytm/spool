import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { HubCredentialOptions } from '../hub/credentials.js'

// The daemon is the always-on half of continuous publishing: a watcher +
// auto-publish loop registered with the OS service manager (launchd on
// macOS, a systemd user unit on Linux) so it survives reboots. The CLI
// process itself stays dumb — supervision, restart, and boot-time start all
// belong to the service manager.

export const DAEMON_SERVICE_LABEL = 'new.spool.daemon'

export interface DaemonHeartbeat {
  pid: number
  startedAt: string
  /** Last completed watch/auto-publish pass. */
  lastPassAt?: string
}

export interface DaemonRuntimeStatus {
  running: boolean
  heartbeat: DaemonHeartbeat | null
}

export type ExecResult = { status: number | null; stderr: string }
export type ExecFn = (command: string, args: string[]) => ExecResult

export interface DaemonServiceDeps extends HubCredentialOptions {
  exec?: ExecFn
  platform?: NodeJS.Platform
  /** Absolute node binary and CLI entry script used to launch `daemon run`. */
  nodeBinary?: string
  cliScript?: string
}

function spoolDir(options: HubCredentialOptions): string {
  const env = options.env ?? process.env
  const home = options.homeDir ?? nonEmpty(env['HOME']) ?? homedir()
  return join(home, '.spool')
}

export function daemonHeartbeatPath(options: HubCredentialOptions = {}): string {
  return join(spoolDir(options), 'daemon.json')
}

export function daemonLogPath(options: HubCredentialOptions = {}): string {
  return join(spoolDir(options), 'daemon.log')
}

export function launchdPlistPath(options: HubCredentialOptions = {}): string {
  const env = options.env ?? process.env
  const home = options.homeDir ?? nonEmpty(env['HOME']) ?? homedir()
  return join(home, 'Library', 'LaunchAgents', `${DAEMON_SERVICE_LABEL}.plist`)
}

export function systemdUnitPath(options: HubCredentialOptions = {}): string {
  const env = options.env ?? process.env
  const home = options.homeDir ?? nonEmpty(env['HOME']) ?? homedir()
  return join(home, '.config', 'systemd', 'user', 'spool-daemon.service')
}

export function writeHeartbeat(
  heartbeat: DaemonHeartbeat,
  options: HubCredentialOptions = {},
): void {
  const path = daemonHeartbeatPath(options)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(heartbeat, null, 2)}\n`, 'utf8')
}

export function clearHeartbeat(options: HubCredentialOptions = {}): void {
  rmSync(daemonHeartbeatPath(options), { force: true })
}

export function readHeartbeat(options: HubCredentialOptions = {}): DaemonHeartbeat | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(daemonHeartbeatPath(options), 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as DaemonHeartbeat).pid === 'number'
    ) {
      return parsed as DaemonHeartbeat
    }
  } catch {
    // Missing or corrupt heartbeat simply reads as "not running".
  }
  return null
}

export function daemonRuntimeStatus(
  options: HubCredentialOptions = {},
  isAlive: (pid: number) => boolean = processAlive,
): DaemonRuntimeStatus {
  const heartbeat = readHeartbeat(options)
  return { running: heartbeat !== null && isAlive(heartbeat.pid), heartbeat }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function renderLaunchdPlist(input: {
  nodeBinary: string
  cliScript: string
  logPath: string
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DAEMON_SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(input.nodeBinary)}</string>
    <string>${escapeXml(input.cliScript)}</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(input.logPath)}</string>
</dict>
</plist>
`
}

export function renderSystemdUnit(input: {
  nodeBinary: string
  cliScript: string
  logPath: string
}): string {
  return `[Unit]
Description=Spool daemon — continuous session publishing

[Service]
ExecStart=${systemdQuote(input.nodeBinary)} ${systemdQuote(input.cliScript)} daemon run
Restart=always
RestartSec=5
StandardOutput=append:${input.logPath}
StandardError=append:${input.logPath}

[Install]
WantedBy=default.target
`
}

export interface ServiceActionResult {
  ok: boolean
  message: string
}

/** Install and start the OS service. Idempotent: re-running rewrites the
 *  definition and restarts the service. */
export function installDaemonService(deps: DaemonServiceDeps = {}): ServiceActionResult {
  const platform = deps.platform ?? process.platform
  const exec = deps.exec ?? defaultExec
  const nodeBinary = deps.nodeBinary ?? process.execPath
  const cliScript = deps.cliScript ?? process.argv[1] ?? ''
  if (!cliScript) return { ok: false, message: 'Cannot determine the spool CLI entry script.' }
  const logPath = daemonLogPath(deps)
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 })

  if (platform === 'darwin') {
    const plist = launchdPlistPath(deps)
    mkdirSync(dirname(plist), { recursive: true })
    writeFileSync(plist, renderLaunchdPlist({ nodeBinary, cliScript, logPath }), 'utf8')
    const domain = `gui/${typeof process.getuid === 'function' ? process.getuid() : 501}`
    // Re-bootstrap cleanly when a previous definition is already loaded.
    exec('launchctl', ['bootout', `${domain}/${DAEMON_SERVICE_LABEL}`])
    const bootstrap = exec('launchctl', ['bootstrap', domain, plist])
    if (bootstrap.status !== 0) {
      return {
        ok: false,
        message: `launchctl bootstrap failed: ${bootstrap.stderr.trim() || `exit ${bootstrap.status}`}`,
      }
    }
    return { ok: true, message: `Registered ${DAEMON_SERVICE_LABEL} with launchd (${plist}).` }
  }

  if (platform === 'linux') {
    const unit = systemdUnitPath(deps)
    mkdirSync(dirname(unit), { recursive: true })
    writeFileSync(unit, renderSystemdUnit({ nodeBinary, cliScript, logPath }), 'utf8')
    const reload = exec('systemctl', ['--user', 'daemon-reload'])
    if (reload.status !== 0) {
      return {
        ok: false,
        message: `systemctl daemon-reload failed: ${reload.stderr.trim() || `exit ${reload.status}`}`,
      }
    }
    const enable = exec('systemctl', ['--user', 'enable', '--now', 'spool-daemon.service'])
    if (enable.status !== 0) {
      return {
        ok: false,
        message: `systemctl enable failed: ${enable.stderr.trim() || `exit ${enable.status}`}`,
      }
    }
    return { ok: true, message: `Registered spool-daemon.service with systemd (${unit}).` }
  }

  return {
    ok: false,
    message: `No service manager integration for ${platform}. Run \`spool daemon run\` in a supervised shell instead.`,
  }
}

/** Stop and unregister the OS service. */
export function uninstallDaemonService(deps: DaemonServiceDeps = {}): ServiceActionResult {
  const platform = deps.platform ?? process.platform
  const exec = deps.exec ?? defaultExec

  if (platform === 'darwin') {
    const domain = `gui/${typeof process.getuid === 'function' ? process.getuid() : 501}`
    const bootout = exec('launchctl', ['bootout', `${domain}/${DAEMON_SERVICE_LABEL}`])
    rmSync(launchdPlistPath(deps), { force: true })
    if (bootout.status !== 0) {
      return {
        ok: true,
        message: 'Daemon was not registered with launchd; removed any stale definition.',
      }
    }
    return { ok: true, message: `Stopped and unregistered ${DAEMON_SERVICE_LABEL}.` }
  }

  if (platform === 'linux') {
    const disable = exec('systemctl', ['--user', 'disable', '--now', 'spool-daemon.service'])
    rmSync(systemdUnitPath(deps), { force: true })
    exec('systemctl', ['--user', 'daemon-reload'])
    if (disable.status !== 0) {
      return {
        ok: true,
        message: 'Daemon was not registered with systemd; removed any stale definition.',
      }
    }
    return { ok: true, message: 'Stopped and unregistered spool-daemon.service.' }
  }

  return { ok: false, message: `No service manager integration for ${platform}.` }
}

function defaultExec(command: string, args: string[]): ExecResult {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return { status: result.status, stderr: result.stderr ?? '' }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function systemdQuote(value: string): string {
  return /[\s"']/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
