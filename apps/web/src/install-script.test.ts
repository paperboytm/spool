import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

const INSTALLER = resolve(import.meta.dirname, '..', 'public', 'install.sh')
const cleanupPaths: string[] = []

interface Fixture {
  root: string
  home: string
  npmLog: string
  env: NodeJS.ProcessEnv
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'spool-cli-installer-'))
  cleanupPaths.push(root)
  const home = join(root, 'home')
  const fakeBin = join(root, 'fake-bin')
  const npmLog = join(root, 'npm.log')
  mkdirSync(home, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })

  const fakeNode = join(fakeBin, 'node')
  writeFileSync(
    fakeNode,
    `#!/bin/sh
if [ "$1" = "-p" ]; then
  printf '%s\\n' "\${FAKE_NODE_VERSION:-22.19.0}"
  exit 0
fi
if [ "$1" = "-e" ]; then
  exit "\${FAKE_NODE_CHECK_EXIT:-0}"
fi
exit 1
`,
  )
  chmodSync(fakeNode, 0o755)

  const fakeNpm = join(fakeBin, 'npm')
  writeFileSync(
    fakeNpm,
    `#!/bin/sh
set -eu
if [ "$1" = "view" ]; then
  if [ "\${FAKE_NPM_VIEW_FAIL:-0}" = "1" ]; then
    exit 1
  fi
  printf '%s\\n' "$FAKE_CLI_VERSION"
  exit 0
fi
if [ "$1" != "install" ]; then
  exit 2
fi
printf '%s\\n' install >> "$FAKE_NPM_LOG"
if [ "\${FAKE_NPM_FAIL:-0}" = "1" ]; then
  printf '%s\\n' 'simulated npm failure' >&2
  exit 1
fi
prefix=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    shift
    prefix=$1
  fi
  shift
done
[ -n "$prefix" ]
mkdir -p "$prefix/bin"
{
  printf '%s\\n' '#!/bin/sh'
  printf '%s\\n' 'if [ "$1" = "--version" ]; then'
  printf '  printf "%%s\\\\n" "%s"\\n' "$FAKE_CLI_VERSION"
  printf '%s\\n' '  exit 0'
  printf '%s\\n' 'fi'
  printf '%s\\n' 'exit 0'
} > "$prefix/bin/spool"
chmod +x "$prefix/bin/spool"
`,
  )
  chmodSync(fakeNpm, 0o755)

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
      FAKE_NPM_LOG: npmLog,
    },
  }
}

function runInstaller(env: NodeJS.ProcessEnv) {
  return spawnSync('sh', [INSTALLER], { encoding: 'utf8', env })
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
    expect(execFileSync(binPath, ['--version'], { encoding: 'utf8' }).trim()).toBe('9.8.7')

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
    expect(execFileSync(binPath, ['--version'], { encoding: 'utf8' }).trim()).toBe('9.8.7')
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
    expect(execFileSync(binPath, ['--version'], { encoding: 'utf8' }).trim()).toBe('9.8.7')
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
