// Unit tests for the on-disk preferences store.
//
// The module reads SPOOL_DIR (resolved from process.env at module
// load via @spool-lab/core's `SPOOL_DIR` export) and reads/writes
// `security.json` next to it. We point SPOOL_DATA_DIR at a temp dir
// before importing the module so each suite gets its own filesystem
// without touching the user's real ~/.spool/.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string
let configPath: string
let mod: typeof import('./securityPreferences.js')

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'spool-prefs-test-'))
  process.env['SPOOL_DATA_DIR'] = tmpDir
  configPath = join(tmpDir, 'security.json')
  // Dynamic import so the env var is set before @spool-lab/core's
  // module-level `SPOOL_DIR = process.env['SPOOL_DATA_DIR'] ?? …`
  // captures the value.
  mod = await import('./securityPreferences.js')
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env['SPOOL_DATA_DIR']
})

beforeEach(() => {
  // Each test starts from a clean security.json so we can assert on
  // raw file content without accumulating state across runs.
  if (existsSync(configPath)) rmSync(configPath)
})

describe('loadSecurityPreferences', () => {
  it('returns hardcoded defaults when the file does not exist', () => {
    const prefs = mod.loadSecurityPreferences()
    expect(prefs).toEqual({
      kindAllowlist: [],
      infoDefaultVisible: false,
      rescanAfterSync: 'auto',
      revealValuesOnHoverOnly: false,
      pfEnabled: false,
      pfCalloutDismissed: false,
      pfActivationPending: false,
    })
  })

  it('returns defaults when the file is empty', () => {
    writeFileSync(configPath, '', 'utf8')
    expect(mod.loadSecurityPreferences().kindAllowlist).toEqual([])
  })

  it('returns defaults when the file is malformed JSON (does not throw)', () => {
    writeFileSync(configPath, '{not valid json', 'utf8')
    expect(() => mod.loadSecurityPreferences()).not.toThrow()
    const prefs = mod.loadSecurityPreferences()
    expect(prefs.kindAllowlist).toEqual([])
    expect(prefs.rescanAfterSync).toBe('auto')
  })

  it('honours stored values', () => {
    writeFileSync(configPath, JSON.stringify({
      kindAllowlist: ['email', 'phone'],
      infoDefaultVisible: true,
      rescanAfterSync: 'manual',
      revealValuesOnHoverOnly: true,
      pfEnabled: true,
    }))
    const prefs = mod.loadSecurityPreferences()
    expect(prefs.kindAllowlist).toEqual(['email', 'phone'])
    expect(prefs.infoDefaultVisible).toBe(true)
    expect(prefs.rescanAfterSync).toBe('manual')
    expect(prefs.revealValuesOnHoverOnly).toBe(true)
    expect(prefs.pfEnabled).toBe(true)
  })

  it('coerces non-boolean truthy values to their defaults', () => {
    // The reader is strict-`=== true`; "true", 1, etc. should not
    // promote to true. This prevents a corrupted/edited file from
    // silently flipping screen-share mode etc.
    writeFileSync(configPath, JSON.stringify({
      infoDefaultVisible: 'true',
      revealValuesOnHoverOnly: 1,
      pfEnabled: 'yes',
    }))
    const prefs = mod.loadSecurityPreferences()
    expect(prefs.infoDefaultVisible).toBe(false)
    expect(prefs.revealValuesOnHoverOnly).toBe(false)
    expect(prefs.pfEnabled).toBe(false)
  })

  it('filters non-string entries out of kindAllowlist', () => {
    writeFileSync(configPath, JSON.stringify({
      kindAllowlist: ['email', 42, null, undefined, 'phone', { kind: 'bad' }],
    }))
    expect(mod.loadSecurityPreferences().kindAllowlist).toEqual(['email', 'phone'])
  })

  it('falls back when kindAllowlist is not an array', () => {
    writeFileSync(configPath, JSON.stringify({ kindAllowlist: 'email' }))
    expect(mod.loadSecurityPreferences().kindAllowlist).toEqual([])
  })

  it('treats an unknown rescanAfterSync value as "auto" (safer default)', () => {
    writeFileSync(configPath, JSON.stringify({ rescanAfterSync: 'whatever' }))
    expect(mod.loadSecurityPreferences().rescanAfterSync).toBe('auto')
  })
})

describe('saveSecurityPreferences', () => {
  it('writes a partial update without dropping unrelated keys on disk', () => {
    // Seed with all fields set.
    writeFileSync(configPath, JSON.stringify({
      kindAllowlist: ['email'],
      infoDefaultVisible: true,
      rescanAfterSync: 'manual',
      revealValuesOnHoverOnly: true,
      pfEnabled: true,
    }))
    // Update only one field.
    mod.saveSecurityPreferences({ kindAllowlist: ['phone'] })
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(onDisk['kindAllowlist']).toEqual(['phone'])
    // Other fields preserved.
    expect(onDisk['infoDefaultVisible']).toBe(true)
    expect(onDisk['rescanAfterSync']).toBe('manual')
    expect(onDisk['revealValuesOnHoverOnly']).toBe(true)
    expect(onDisk['pfEnabled']).toBe(true)
  })

  it('normalises bad inputs as it writes them', () => {
    mod.saveSecurityPreferences({
      // `unknown` cast simulates a buggy caller / IPC payload.
      kindAllowlist: ['email', 42 as unknown as never, 'phone'],
      infoDefaultVisible: 'true' as unknown as boolean,
      rescanAfterSync: 'whatever' as unknown as 'auto',
    })
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(onDisk['kindAllowlist']).toEqual(['email', 'phone'])
    expect(onDisk['infoDefaultVisible']).toBe(false)
    expect(onDisk['rescanAfterSync']).toBe('auto')
  })

  it('returns the freshly-loaded value so callers see the merged result', () => {
    const result = mod.saveSecurityPreferences({ kindAllowlist: ['email'] })
    expect(result.kindAllowlist).toEqual(['email'])
    // Fields not in `next` come back from defaults.
    expect(result.rescanAfterSync).toBe('auto')
    expect(result.infoDefaultVisible).toBe(false)
  })

  it('preserves unknown forward-compat keys', () => {
    writeFileSync(configPath, JSON.stringify({
      kindAllowlist: ['email'],
      experimentalThing: { nested: 1 },
    }))
    mod.saveSecurityPreferences({ kindAllowlist: ['phone'] })
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(onDisk['experimentalThing']).toEqual({ nested: 1 })
  })

  it('creates SPOOL_DIR (and the file) on first save when nothing exists yet', () => {
    rmSync(configPath, { force: true })
    expect(existsSync(configPath)).toBe(false)
    mod.saveSecurityPreferences({ kindAllowlist: ['email'] })
    expect(existsSync(configPath)).toBe(true)
  })

  it('is idempotent over identical writes', () => {
    mod.saveSecurityPreferences({ kindAllowlist: ['email'] })
    const first = readFileSync(configPath, 'utf8')
    mod.saveSecurityPreferences({ kindAllowlist: ['email'] })
    const second = readFileSync(configPath, 'utf8')
    expect(first).toBe(second)
  })

  it('round-trips through load', () => {
    mod.saveSecurityPreferences({
      kindAllowlist: ['email', 'phone'],
      infoDefaultVisible: true,
      rescanAfterSync: 'manual',
      revealValuesOnHoverOnly: true,
      pfEnabled: true,
    })
    expect(mod.loadSecurityPreferences()).toEqual({
      kindAllowlist: ['email', 'phone'],
      infoDefaultVisible: true,
      rescanAfterSync: 'manual',
      revealValuesOnHoverOnly: true,
      pfEnabled: true,
      // Side-effect of saveSecurityPreferences: flipping pfEnabled on
      // also auto-sets pfCalloutDismissed so the in-page discovery
      // banner doesn't re-appear after the user opts in.
      pfCalloutDismissed: true,
      pfActivationPending: false,
    })
  })

  it('flipping pfEnabled off does NOT touch pfCalloutDismissed', () => {
    mod.saveSecurityPreferences({ pfCalloutDismissed: true })
    mod.saveSecurityPreferences({ pfEnabled: false })
    expect(mod.loadSecurityPreferences().pfCalloutDismissed).toBe(true)
  })

  it('explicit pfCalloutDismissed:false can re-arm the callout', () => {
    mod.saveSecurityPreferences({ pfEnabled: true })  // also flips dismissed to true
    expect(mod.loadSecurityPreferences().pfCalloutDismissed).toBe(true)
    mod.saveSecurityPreferences({ pfEnabled: false, pfCalloutDismissed: false })
    expect(mod.loadSecurityPreferences().pfCalloutDismissed).toBe(false)
  })

  // Filesystem-error path is exercised on platforms where chmod is
  // effective. macOS in CI sandboxes may ignore 0o000 for the owner;
  // we skip if the chmod didn't actually deny writes.
  it('returns load() defaults when readFile throws (e.g. permission denied)', () => {
    writeFileSync(configPath, JSON.stringify({ kindAllowlist: ['email'] }))
    try {
      chmodSync(configPath, 0o000)
      // If the platform still lets us read, skip the assertion.
      let denied = false
      try { readFileSync(configPath, 'utf8') } catch { denied = true }
      if (!denied) return
      const prefs = mod.loadSecurityPreferences()
      expect(prefs.kindAllowlist).toEqual([])
    } finally {
      try { chmodSync(configPath, 0o600) } catch { /* ignore */ }
    }
  })
})

describe('DEFAULT_SECURITY_PREFERENCES', () => {
  it('matches the defaults returned by loadSecurityPreferences() on a missing file', () => {
    rmSync(configPath, { force: true })
    expect(mod.loadSecurityPreferences()).toEqual(mod.DEFAULT_SECURITY_PREFERENCES)
  })

  it('is frozen-as-data (kindAllowlist is a fresh empty array, not a shared reference)', () => {
    // Defensive: a future refactor that returned the same array
    // instance from the const would let callers mutate the singleton.
    const a = mod.loadSecurityPreferences().kindAllowlist
    a.push('email' as never)
    const b = mod.loadSecurityPreferences().kindAllowlist
    expect(b).toEqual([])
  })
})
