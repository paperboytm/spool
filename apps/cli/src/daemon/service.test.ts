import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  DAEMON_SERVICE_LABEL,
  clearHeartbeat,
  daemonRuntimeStatus,
  installDaemonService,
  launchdPlistPath,
  readHeartbeat,
  renderLaunchdPlist,
  renderSystemdUnit,
  systemdUnitPath,
  uninstallDaemonService,
  writeHeartbeat,
  type ExecFn,
} from './service.js'

const dirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-daemon-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function recordingExec(status = 0): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = []
  return {
    exec: (command, args) => {
      calls.push([command, ...args])
      return { status, stderr: status === 0 ? '' : 'boom' }
    },
    calls,
  }
}

describe('daemon heartbeat', () => {
  it('round-trips and derives running state from the pid', () => {
    const home = tempHome()
    expect(readHeartbeat({ homeDir: home })).toBeNull()

    writeHeartbeat({ pid: 4242, startedAt: '2026-07-24T00:00:00.000Z' }, { homeDir: home })
    expect(readHeartbeat({ homeDir: home })).toEqual({
      pid: 4242,
      startedAt: '2026-07-24T00:00:00.000Z',
    })

    expect(daemonRuntimeStatus({ homeDir: home }, () => true).running).toBe(true)
    expect(daemonRuntimeStatus({ homeDir: home }, () => false).running).toBe(false)

    clearHeartbeat({ homeDir: home })
    expect(readHeartbeat({ homeDir: home })).toBeNull()
  })
})

describe('service definitions', () => {
  it('renders a launchd plist with KeepAlive and escaped paths', () => {
    const plist = renderLaunchdPlist({
      nodeBinary: '/usr/local/bin/node',
      cliScript: '/opt/spool & tools/spool.js',
      logPath: '/home/u/.spool/daemon.log',
    })
    expect(plist).toContain(`<string>${DAEMON_SERVICE_LABEL}</string>`)
    expect(plist).toContain('<string>/usr/local/bin/node</string>')
    expect(plist).toContain('<string>/opt/spool &amp; tools/spool.js</string>')
    expect(plist).toContain('<string>daemon</string>')
    expect(plist).toContain('<string>run</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<string>/home/u/.spool/daemon.log</string>')
  })

  it('renders a systemd unit that restarts and appends to the log', () => {
    const unit = renderSystemdUnit({
      nodeBinary: '/usr/bin/node',
      cliScript: '/opt/my tools/spool.js',
      logPath: '/home/u/.spool/daemon.log',
    })
    expect(unit).toContain('ExecStart=/usr/bin/node "/opt/my tools/spool.js" daemon run')
    expect(unit).toContain('Restart=always')
    expect(unit).toContain('StandardOutput=append:/home/u/.spool/daemon.log')
    expect(unit).toContain('WantedBy=default.target')
  })
})

describe('service install/uninstall', () => {
  it('writes the plist and bootstraps launchd on macOS', () => {
    const home = tempHome()
    const { exec, calls } = recordingExec()

    const result = installDaemonService({
      homeDir: home,
      platform: 'darwin',
      exec,
      nodeBinary: '/usr/local/bin/node',
      cliScript: '/opt/spool.js',
    })

    expect(result.ok).toBe(true)
    const plist = launchdPlistPath({ homeDir: home })
    expect(existsSync(plist)).toBe(true)
    expect(readFileSync(plist, 'utf8')).toContain(DAEMON_SERVICE_LABEL)
    expect(calls.some((call) => call[0] === 'launchctl' && call[1] === 'bootstrap')).toBe(true)
  })

  it('removes the plist and boots the service out on uninstall', () => {
    const home = tempHome()
    const { exec } = recordingExec()
    installDaemonService({
      homeDir: home,
      platform: 'darwin',
      exec,
      nodeBinary: '/usr/local/bin/node',
      cliScript: '/opt/spool.js',
    })

    const result = uninstallDaemonService({ homeDir: home, platform: 'darwin', exec })
    expect(result.ok).toBe(true)
    expect(existsSync(launchdPlistPath({ homeDir: home }))).toBe(false)
  })

  it('writes a unit and enables it via systemctl on Linux', () => {
    const home = tempHome()
    const { exec, calls } = recordingExec()

    const result = installDaemonService({
      homeDir: home,
      platform: 'linux',
      exec,
      nodeBinary: '/usr/bin/node',
      cliScript: '/opt/spool.js',
    })

    expect(result.ok).toBe(true)
    expect(existsSync(systemdUnitPath({ homeDir: home }))).toBe(true)
    expect(calls).toContainEqual(['systemctl', '--user', 'daemon-reload'])
    expect(calls).toContainEqual(['systemctl', '--user', 'enable', '--now', 'spool-daemon.service'])
  })

  it('surfaces service-manager failures', () => {
    const home = tempHome()
    const { exec } = recordingExec(1)
    const result = installDaemonService({
      homeDir: home,
      platform: 'linux',
      exec,
      nodeBinary: '/usr/bin/node',
      cliScript: '/opt/spool.js',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('daemon-reload failed')
  })

  it('refuses unsupported platforms with a foreground hint', () => {
    const result = installDaemonService({
      homeDir: tempHome(),
      platform: 'win32',
      exec: recordingExec().exec,
      nodeBinary: 'node',
      cliScript: 'spool.js',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('daemon run')
  })
})
