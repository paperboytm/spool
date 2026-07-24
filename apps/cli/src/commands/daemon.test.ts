import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { writeHeartbeat, type ExecFn } from '../daemon/service.js'
import { saveSubscriptions } from '../subscriptions.js'
import { createTextUi } from '../ui.js'
import {
  handleDaemonLogs,
  handleDaemonStart,
  handleDaemonStatus,
  handleDaemonStop,
} from './daemon.js'

const dirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-daemon-cmd-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function capturingUi() {
  const output: string[] = []
  const errors: string[] = []
  return {
    ui: createTextUi(
      (message) => output.push(message),
      (message) => errors.push(message),
    ),
    output,
    errors,
  }
}

const okExec: ExecFn = () => ({ status: 0, stderr: '' })

describe('daemon commands', () => {
  it('start registers the service and hints at status', () => {
    const home = tempHome()
    const { ui, output } = capturingUi()
    expect(
      handleDaemonStart(
        {
          homeDir: home,
          platform: 'darwin',
          exec: okExec,
          nodeBinary: '/usr/local/bin/node',
          cliScript: '/opt/spool.js',
        },
        ui,
      ),
    ).toBe(0)
    expect(output.join('\n')).toContain('launchd')
    expect(output.join('\n')).toContain('daemon status')
  })

  it('start warns when nothing is subscribed yet', () => {
    const home = tempHome()
    const { ui, output } = capturingUi()
    handleDaemonStart(
      {
        homeDir: home,
        platform: 'linux',
        exec: okExec,
        nodeBinary: '/usr/bin/node',
        cliScript: '/opt/spool.js',
      },
      ui,
    )
    expect(output.join('\n')).toContain('No subscribed directories yet')
  })

  it('stop unregisters the service', () => {
    const home = tempHome()
    const { ui, output } = capturingUi()
    expect(handleDaemonStop({ homeDir: home, platform: 'darwin', exec: okExec }, ui)).toBe(0)
    expect(output.join('\n')).toContain('Daemon stopped')
  })

  it('status reports a live heartbeat with subscriptions', () => {
    const home = tempHome()
    writeHeartbeat(
      { pid: 4242, startedAt: '2026-07-24T00:00:00.000Z', lastPassAt: '2026-07-24T00:05:00.000Z' },
      { homeDir: home },
    )
    saveSubscriptions(
      [
        {
          path: '/repos/spool',
          visibility: 'team',
          teamId: 'team_00000001',
          teamName: 'Paperboy',
          addedAt: '2026-07-24T00:00:00.000Z',
        },
      ],
      { homeDir: home },
    )
    const { ui, output } = capturingUi()
    expect(handleDaemonStatus({ homeDir: home, isAlive: () => true }, ui)).toBe(0)
    const text = output.join('\n')
    expect(text).toContain('pid 4242')
    expect(text).toContain('Last publish pass: 2026-07-24T00:05:00.000Z')
    expect(text).toContain('Team · Paperboy')
  })

  it('status exits non-zero when subscriptions exist but the daemon is down', () => {
    const home = tempHome()
    saveSubscriptions(
      [{ path: '/repos/spool', visibility: 'link-only', addedAt: '2026-07-24T00:00:00.000Z' }],
      { homeDir: home },
    )
    const { ui, output } = capturingUi()
    expect(handleDaemonStatus({ homeDir: home, isAlive: () => false }, ui)).toBe(1)
    expect(output.join('\n')).toContain('Daemon not running')
  })

  it('logs reports a missing log file gracefully', () => {
    const home = tempHome()
    const { ui, output } = capturingUi()
    expect(handleDaemonLogs(50, { homeDir: home }, ui)).toBe(0)
    expect(output.join('\n')).toContain('No daemon log')
  })
})
