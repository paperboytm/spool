import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

const INSTALLER = resolve(import.meta.dirname, '..', 'public', 'install.sh')
const INSTALLER_COMMAND = resolve(
  import.meta.dirname,
  '..',
  'test-fixtures',
  'installer-command.sh',
)
const cleanupPaths: string[] = []

interface Fixture {
  root: string
  home: string
  npmLog: string
  env: NodeJS.ProcessEnv
}

function fixture(): Fixture {
  // macOS can indefinitely defer direct execution of fresh shebang scripts
  // from its per-user temporary volume. Keep executable fixtures beside the
  // test and remove them after each case so the installer contract stays
  // deterministic across local development and CI.
  const root = mkdtempSync(join(import.meta.dirname, '.spool-cli-installer-'))
  cleanupPaths.push(root)
  const home = join(root, 'home')
  const fakeBin = join(root, 'fake-bin')
  const npmLog = join(root, 'npm.log')
  mkdirSync(home, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })

  return {
    root,
    home,
    npmLog,
    env: {
      ...process.env,
      HOME: home,
      SHELL: '/bin/zsh',
      PATH: `${fakeBin}:/usr/bin:/bin`,
      FAKE_CLI_VERSION: '9.8.7',
      FAKE_INSTALLER_COMMAND: INSTALLER_COMMAND,
      FAKE_NPM_LOG: npmLog,
      _SPOOL_INSTALLER_TEST_SHIM: INSTALLER_COMMAND,
    },
  }
}

function runInstaller(env: NodeJS.ProcessEnv) {
  return spawnSync('sh', [INSTALLER], { encoding: 'utf8', env })
}

function installedVersion(path: string, env: NodeJS.ProcessEnv): string {
  return execFileSync('sh', [INSTALLER_COMMAND, 'spool', path, '--version'], {
    encoding: 'utf8',
    env,
  }).trim()
}

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop()
    if (path) rmSync(path, { recursive: true, force: true })
  }
})

describe('CLI install.sh', () => {
  it('is valid POSIX shell syntax', () => {
    const result = spawnSync('sh', ['-n', INSTALLER], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('installs atomically, configures PATH once, and skips an installed version', () => {
    const test = fixture()
    const first = runInstaller(test.env)

    expect(first.status).toBe(0)
    expect(first.stdout).toContain('Spool CLI 9.8.7 installed')
    const binPath = join(test.home, '.local', 'bin', 'spool')
    expect(readlinkSync(binPath)).toContain('/.local/share/spool/cli/9.8.7/bin/spool')
    expect(installedVersion(binPath, test.env)).toBe('9.8.7')

    const second = runInstaller(test.env)
    expect(second.status).toBe(0)
    expect(readFileSync(test.npmLog, 'utf8').trim().split('\n')).toEqual(['install'])
    const rc = readFileSync(join(test.home, '.zshrc'), 'utf8')
    expect(rc.match(/# Added by the Spool CLI installer/g)).toHaveLength(1)
  }, 15_000)

  it('explains the Node.js requirement before changing the install', () => {
    const test = fixture()
    const result = runInstaller({
      ...test.env,
      FAKE_NODE_VERSION: '22.18.0',
      FAKE_NODE_CHECK_EXIT: '1',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Node.js 22.18.0 is too old')
    expect(result.stderr).toContain('22.19.0 or newer')
  })

  it('rejects an npm version that cannot be used as a safe install directory', () => {
    const test = fixture()
    const result = runInstaller({ ...test.env, FAKE_CLI_VERSION: '..' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('npm returned an invalid Spool CLI version')
  })

  it('keeps the working CLI available when a later npm install fails', () => {
    const test = fixture()
    expect(runInstaller(test.env).status).toBe(0)
    const binPath = join(test.home, '.local', 'bin', 'spool')
    const originalTarget = readlinkSync(binPath)

    const failed = runInstaller({
      ...test.env,
      FAKE_CLI_VERSION: '9.8.8',
      FAKE_NPM_FAIL: '1',
    })

    expect(failed.status).toBe(0)
    expect(failed.stderr).toContain('simulated npm failure')
    expect(failed.stderr).toContain('Keeping Spool CLI 9.8.7')
    expect(readlinkSync(binPath)).toBe(originalTarget)
    expect(installedVersion(binPath, test.env)).toBe('9.8.7')
  })

  it('keeps the working CLI available when npm cannot be reached', () => {
    const test = fixture()
    expect(runInstaller(test.env).status).toBe(0)
    const binPath = join(test.home, '.local', 'bin', 'spool')
    const originalTarget = readlinkSync(binPath)

    const offline = runInstaller({ ...test.env, FAKE_NPM_VIEW_FAIL: '1' })

    expect(offline.status).toBe(0)
    expect(offline.stderr).toContain('Could not check npm for updates')
    expect(readlinkSync(binPath)).toBe(originalTarget)
    expect(installedVersion(binPath, test.env)).toBe('9.8.7')
  })

  it('keeps the working CLI available when the target version directory is incomplete', () => {
    const test = fixture()
    expect(runInstaller(test.env).status).toBe(0)
    const binPath = join(test.home, '.local', 'bin', 'spool')
    const originalTarget = readlinkSync(binPath)
    mkdirSync(join(test.home, '.local', 'share', 'spool', 'cli', '9.8.8'))

    const result = runInstaller({ ...test.env, FAKE_CLI_VERSION: '9.8.8' })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('is incomplete. Keeping Spool CLI 9.8.7')
    expect(readlinkSync(binPath)).toBe(originalTarget)
  })

  it('uses the profile fallback when SHELL is unset', () => {
    const test = fixture()
    const env = { ...test.env, SHELL: '' }

    const result = runInstaller(env)

    expect(result.status).toBe(0)
    expect(readFileSync(join(test.home, '.profile'), 'utf8')).toContain(
      '# Added by the Spool CLI installer',
    )
  })

  it('repairs an interrupted PATH update that wrote only the marker', () => {
    const test = fixture()
    const rcPath = join(test.home, '.zshrc')
    writeFileSync(rcPath, '# Added by the Spool CLI installer\n')

    const result = runInstaller(test.env)

    expect(result.status).toBe(0)
    expect(readFileSync(rcPath, 'utf8')).toContain('export PATH="$HOME/.local/bin:$PATH"')
  })

  it('does not overwrite an unrelated spool executable', () => {
    const test = fixture()
    const binDir = join(test.home, '.local', 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'spool'), '#!/bin/sh\nexit 0\n')

    const result = runInstaller(test.env)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not managed by the Spool installer')
  })
})
