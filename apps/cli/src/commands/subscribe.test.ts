import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { loadSubscriptions } from '../subscriptions.js'
import { createTextUi } from '../ui.js'
import {
  handleSubscribeCommand,
  handleSubscriptionsCommand,
  handleUnsubscribeCommand,
} from './subscribe.js'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
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

describe('subscribe command', () => {
  it('requires --yes without a TTY so visibility stays an explicit decision', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, errors } = capturingUi()

    expect(await handleSubscribeCommand(project, {}, { ui, homeDir: home, cwd: project })).toBe(1)
    expect(errors.join('\n')).toContain('--yes')
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('subscribes the current directory with --yes and discloses visibility', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    expect(
      await handleSubscribeCommand(
        undefined,
        { yes: true },
        { ui, homeDir: home, cwd: project, now: () => '2026-07-24T00:00:00.000Z' },
      ),
    ).toBe(0)
    expect(output.join('\n')).toContain('auto-publish')
    expect(loadSubscriptions({ homeDir: home })).toEqual([
      { path: project, visibility: 'provider-default', addedAt: '2026-07-24T00:00:00.000Z' },
    ])
  })

  it('stores the Link-only choice and lists it', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { yes: true, linkOnly: true },
        { ui, homeDir: home, cwd: project },
      ),
    ).toBe(0)
    expect(loadSubscriptions({ homeDir: home })[0]?.visibility).toBe('link-only')

    expect(handleSubscriptionsCommand({ ui, homeDir: home })).toBe(0)
    expect(output.join('\n')).toContain(`${project}  (Link-only)`)
  })

  it('unsubscribes by path and reports unknown directories', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    await handleSubscribeCommand(project, { yes: true }, { ui, homeDir: home, cwd: project })
    expect(await handleUnsubscribeCommand(project, { ui, homeDir: home, cwd: project })).toBe(0)
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
    expect(output.join('\n')).toContain('Already-published sessions stay live')

    expect(await handleUnsubscribeCommand(project, { ui, homeDir: home, cwd: project })).toBe(1)
  })

  it('rejects a missing directory', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, errors } = capturingUi()

    expect(
      await handleSubscribeCommand(
        join(project, 'missing'),
        { yes: true },
        { ui, homeDir: home, cwd: project },
      ),
    ).toBe(1)
    expect(errors.length).toBeGreaterThan(0)
  })
})
