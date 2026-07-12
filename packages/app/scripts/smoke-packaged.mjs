import { _electron as electron } from '@playwright/test'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(process.argv.slice(2).find(arg => !arg.startsWith('-')) ?? 'dist/mac-arm64/Spool.app')
const fullPrivacyFilter = process.argv.includes('--full-pf')
const keepProfile = process.argv.includes('--keep-profile')
const executablePath = join(appDir, 'Contents', 'MacOS', 'Spool')
if (!existsSync(executablePath)) throw new Error(`Packaged executable not found: ${executablePath}`)
const unpackedModules = join(appDir, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules')
assert(existsSync(join(unpackedModules, 'acp-extension-claude', 'dist', 'index.js')), 'packaged Claude ACP extension is missing')
assert(existsSync(join(unpackedModules, 'acp-extension-codex-darwin-arm64', 'bin', 'acp-extension-codex')), 'packaged Codex ACP extension is missing')

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDir = join(packageDir, 'e2e', 'fixtures')
const mocksDir = join(packageDir, 'e2e', 'mocks')
const tempDir = mkdtempSync(join(tmpdir(), 'spool-packaged-smoke-'))
const claudeDir = join(tempDir, 'claude', 'projects')
const codexDir = join(tempDir, 'codex', 'sessions')
const geminiDir = join(tempDir, 'gemini')
const opencodeDir = join(tempDir, 'opencode')
const spoolHome = join(tempDir, 'spool-home')
const mockBinDir = join(tempDir, 'bin')
const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
const sensitiveFixture = join(claudeDir, 'package-smoke', 'sensitive.jsonl')

mkdirSync(join(claudeDir, 'test-project'), { recursive: true })
cpSync(
  join(fixturesDir, 'claude-projects', 'test-project', 'test-session-001.jsonl'),
  join(claudeDir, 'test-project', 'test-session-001.jsonl'),
)
mkdirSync(codexDir, { recursive: true })
mkdirSync(geminiDir, { recursive: true })
mkdirSync(join(claudeDir, 'package-smoke'), { recursive: true })
mkdirSync(opencodeDir, { recursive: true })
mkdirSync(spoolHome, { recursive: true })
mkdirSync(mockBinDir, { recursive: true })
writeFileSync(sensitiveFixture, JSON.stringify({
  type: 'user',
  uuid: 'packaged-sensitive-message',
  timestamp: '2026-07-12T00:00:00.000Z',
  message: { role: 'user', content: `PACKAGED_SMOKE_SECRET ${secret}. My name is Harry Potter and my email is harry.potter@hogwarts.edu.` },
  sessionId: 'packaged-sensitive-session',
  cwd: '/tmp/package-smoke',
}) + '\n')
writeFileSync(join(spoolHome, 'agents.json'), JSON.stringify({ securityEnabled: true, defaultAgent: 'claude' }))
for (const name of ['claude', 'codex']) {
  const path = join(mockBinDir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
}

const env = {
  ...process.env,
  SPOOL_DATA_DIR: join(tempDir, 'data'),
  SPOOL_ELECTRON_USER_DATA_DIR: join(tempDir, 'electron-user-data'),
  SPOOL_HOME: spoolHome,
  SPOOL_CLAUDE_DIR: claudeDir,
  SPOOL_CODEX_DIR: codexDir,
  SPOOL_GEMINI_DIR: geminiDir,
  GEMINI_CLI_HOME: geminiDir,
  SPOOL_OPENCODE_DIR: opencodeDir,
  SPOOL_ACP_AGENT_BIN: join(mocksDir, 'acp-mock-agent.mjs'),
  PATH: `${mockBinDir}:${process.env.PATH ?? ''}`,
  ELECTRON_DISABLE_GPU: '1',
}

let app
try {
  app = await electron.launch({
    executablePath,
    args: ['--force-prefers-reduced-motion'],
    cwd: packageDir,
    env,
    timeout: 30_000,
  })
  if (fullPrivacyFilter) {
    app.process().stdout?.on('data', chunk => process.stdout.write(`[packaged-main] ${chunk}`))
    app.process().stderr?.on('data', chunk => process.stderr.write(`[packaged-main] ${chunk}`))
  }
  const window = await app.firstWindow()

  const searchResults = await poll(async () => {
    const results = await window.evaluate(async () => globalThis.spool?.search('XYLOPHONE_CANARY_42', 5) ?? [])
    return results.length > 0 ? results : null
  }, 'fixture indexing')
  assert(searchResults.length > 0, 'packaged SQLite search returned no fixture result')

  const agents = await window.evaluate(async () => globalThis.spool.getAiAgents())
  for (const agentId of ['claude', 'codex']) {
    assert(agents.some(agent => agent.id === agentId && agent.status === 'ready'), `${agentId} was not detected`)
    const response = await window.evaluate(async (id) => globalThis.spool.aiSearch('packaged ACP smoke', id, []), agentId)
    assert(response.ok && response.fullText?.includes('MOCK_ACP_RESPONSE_42'), `${agentId} ACP launch failed: ${response.error ?? 'empty response'}`)
  }

  await poll(async () => window.evaluate(async () => {
    const security = globalThis.spool?.security
    if (!security) return false
    try {
      await security.getScanStatus()
      return true
    } catch {
      return false
    }
  }), 'Security IPC')

  const ortResource = await app.evaluate(async ({ net }) => {
    const response = await net.fetch('pf-model:///ort/ort-wasm-simd-threaded.mjs')
    return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength }
  })
  assert(ortResource.ok && ortResource.bytes > 1000, 'packaged ORT Web runtime is unavailable')

  await window.evaluate(async () => globalThis.spool.security.rescanAll())
  await poll(async () => window.evaluate(async () => {
    const status = await globalThis.spool.security.getScanStatus()
    return status.queued === 0 && status.scanning === null && status.backfillRemaining === 0
  }), 'Security scan completion')
  const sensitiveResults = await window.evaluate(async () => globalThis.spool.search('PACKAGED_SMOKE_SECRET', 5))
  assert(sensitiveResults.length > 0, 'sensitive package-smoke session was not indexed')
  const sensitiveSessionId = sensitiveResults[0].sessionId
  const findings = await window.evaluate(
    async (sessionId) => globalThis.spool.security.listFindings({ sessionId, state: 'active' }),
    sensitiveSessionId,
  )
  const apiKey = findings.find(finding => finding.kind === 'api-key')
  assert(apiKey, 'packaged Security scanner did not detect the fixture API key')
  await window.evaluate(async (findingId) => globalThis.spool.security.purgeFinding(findingId), apiKey.id)
  const purgedSession = await window.evaluate(async () => globalThis.spool.getSession('packaged-sensitive-session'))
  const purgedText = purgedSession?.messages.map(message => message.contentText).join('\n') ?? ''
  assert(!purgedText.includes(secret) && purgedText.includes('[redacted:'), 'packaged purge did not mask the indexed message')
  const postPurgeSearch = await window.evaluate(async (query) => globalThis.spool.search(query, 5), secret)
  assert(postPurgeSearch.length === 0, 'purged secret remains searchable in packaged FTS')

  let pfState = await window.evaluate(async () => globalThis.spool.security.pfGetState())
  let pfRuntime = null
  if (fullPrivacyFilter) {
    if (pfState.phase !== 'installed') {
      const download = await window.evaluate(async () => globalThis.spool.security.pfDownloadStart())
      assert(download.ok, `Privacy Filter download failed: ${download.reason ?? 'unknown error'}`)
      pfState = await window.evaluate(async () => globalThis.spool.security.pfGetState())
    }
    assert(pfState.phase === 'installed', `Privacy Filter was not installed: ${pfState.phase}`)
    await window.evaluate(async () => globalThis.spool.security.setPrefs({ pfEnabled: true }))
    pfRuntime = await poll(
      async () => window.evaluate(async () => globalThis.spool.security.pfGetRuntimeInfo()),
      'Privacy Filter runtime',
      180_000,
    )
    await window.evaluate(async () => globalThis.spool.security.rescanAll())
    const pfScanStatus = await poll(async () => window.evaluate(async () => {
      const status = await globalThis.spool.security.getScanStatus()
      return status.currentProfile.includes('pf@')
        && status.queued === 0
        && status.scanning === null
        && status.backfillRemaining === 0
        ? status
        : null
    }), 'Privacy Filter scan completion', 180_000)
    assert(pfScanStatus.currentProfile.includes('pf@'), `scan profile did not enable Privacy Filter: ${pfScanStatus.currentProfile}`)
  }
  assert(['not-installed', 'installed'].includes(pfState.phase), `unexpected Privacy Filter state: ${pfState.phase}`)
  console.log(JSON.stringify({
    app: appDir,
    sessionsIndexed: true,
    search: true,
    acp: ['claude', 'codex'],
    privacyFilterRuntimeBytes: ortResource.bytes,
    privacyFilterRuntime: pfRuntime,
    securityScanAndPurge: true,
    privacyFilterState: pfState.phase,
  }, null, 2))
} finally {
  await app?.close().catch(() => {})
  if (keepProfile) console.log(`Kept packaged smoke profile: ${tempDir}`)
  else rmSync(tempDir, { recursive: true, force: true })
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

async function poll(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
