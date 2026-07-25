import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const TARGET = Object.freeze({
  accountId: '6898ecdad1e8341d3e09d4b46124d72e',
  databaseId: 'fa7aa980-e646-4ebe-8c2f-bf5d5d30ab9d',
  databaseName: 'spool-share-db',
  migration: '0011_titles_cost.sql',
})

const EXPECTED_LIVE_SESSIONS = 9
const EXPECTED_PROJECTIONS = 7
const EXPECTED_SCOPES = Object.freeze({ public: 7, linkOnly: 1, team: 1 })
const MAX_MAPPING_BYTES = 2 * 1024 * 1024
const MAX_TITLE_CHARACTERS = 96
const MAX_SUMMARY_CHARACTERS = 4_000
const MAX_SEARCH_BYTES = 16 * 1024
const SHA256_RE = /^[0-9a-f]{64}$/i
const SID_RE = /^(?:claude|codex|pi)_[0-9A-Za-z-]{8,64}$/
const ROOT_RE = /^[0-9a-f]{64}$/
const TEAM_ID_RE = /^team_[0-9A-Za-z_-]{8,128}$/
const encoder = new TextEncoder()

const scriptPath = fileURLToPath(import.meta.url)
const appDir = dirname(dirname(scriptPath))
const repoRoot = resolve(appDir, '../..')
const productionConfigPath = join(appDir, 'wrangler.prod.toml')
const wranglerEntrypoint = join(appDir, 'node_modules/wrangler/bin/wrangler.js')

const projectionKeys = Object.freeze([
  'additions',
  'agent',
  'costUsd',
  'deletions',
  'fileCount',
  'lineageSourceSid',
  'messageCount',
  'publishedAt',
  'qualityScore',
  'searchText',
  'summaryText',
  'title',
  'titleJson',
  'toolCallCount',
  'totalTokens',
  'updatedAt',
])

function usage() {
  return `Usage:
  node scripts/backfill-session-titles.mjs --mapping /absolute/private/mapping.json
  node scripts/backfill-session-titles.mjs --mapping /absolute/private/mapping.json \\
    --apply --mapping-sha <sha256>

The default is a remote, read-only dry-run. The mapping must be outside the
repository and readable only by its owner. --apply requires the SHA-256 printed
by a dry-run of those exact mapping bytes. Run this script with Node 22.

Private mapping schema (exact keys; 9 Sessions, 7 with projections):
{
  "version": 1,
  "target": {
    "accountId": "${TARGET.accountId}",
    "databaseId": "${TARGET.databaseId}",
    "databaseName": "${TARGET.databaseName}",
    "migration": "${TARGET.migration}"
  },
  "sessions": [{
    "sid": "<provider_session-id>",
    "expected": {
      "root": "<sha256>", "updatedAt": 0, "visibility": "unlisted",
      "teamId": null, "withdrawnAt": null,
      "noteSha256": "<sha256 of raw UTF-8 note; null hashes as empty bytes>",
      "noteMd": "<full current preimage or null>",
      "projection": "<full current projection object or null>"
    },
    "replacement": {
      "titles": { "en": "<task outcome>", "zh": "<task outcome>" },
      "summaryBodyMd": "<summary body without front matter>",
      "projection": {
        "qualityScore": 0,
        "searchText": "<lower-case title + Chinese title + plain summary + retained evidence>"
      }
    }
  }]
}

For non-Public Sessions, replacement.projection is null. Public expected
projections use these exact keys: ${projectionKeys.join(', ')}.`
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    help: false,
    mappingPath: null,
    mappingSha: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--apply') {
      options.apply = true
    } else if (argument === '--mapping') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--mapping requires a path')
      options.mappingPath = value
      index += 1
    } else if (argument === '--mapping-sha') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--mapping-sha requires a SHA-256')
      options.mappingSha = value.toLowerCase()
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (options.help) return options
  if (!options.mappingPath) throw new Error('--mapping is required')
  if (options.mappingSha !== null && !SHA256_RE.test(options.mappingSha)) {
    throw new Error('--mapping-sha must be exactly 64 hexadecimal characters')
  }
  if (options.apply && options.mappingSha === null) {
    throw new Error('--apply requires --mapping-sha from a dry-run of the exact mapping file')
  }
  return options
}

function assertNode22() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
  if (major !== 22) {
    throw new Error(`Node 22 is required; current runtime is Node ${process.versions.node}`)
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function noteSha256(noteMd) {
  return sha256(Buffer.from(noteMd ?? '', 'utf8'))
}

function characterLength(value) {
  return Array.from(value).length
}

function boundCharacters(value, maxCharacters) {
  return Array.from(value).slice(0, maxCharacters).join('')
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim()
}

export function markdownToPlainText(markdown) {
  return collapseWhitespace(
    markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>\n]*>/g, ' ')
      .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, '')
      .replace(/[*_~`]/g, ''),
  )
}

function requireRecord(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value
}

function requireExactKeys(value, keys, path) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} has missing or unknown fields`)
  }
}

function requireString(value, path, options = {}) {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  if (options.nonEmpty && value.length === 0) throw new Error(`${path} must not be empty`)
  return value
}

function requireNullableString(value, path) {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`${path} must be a string or null`)
  }
  return value
}

function requireNumber(value, path, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`)
  }
  if (options.integer && !Number.isInteger(value)) throw new Error(`${path} must be an integer`)
  if (options.nonNegative && value < 0) throw new Error(`${path} must be non-negative`)
  return value
}

function requireNullableNumber(value, path, options = {}) {
  if (value === null) return value
  return requireNumber(value, path, options)
}

function validateTitle(value, path) {
  requireString(value, path, { nonEmpty: true })
  if (value !== value.trim() || /[\r\n\u0000]/u.test(value)) {
    throw new Error(`${path} must be a trimmed single line`)
  }
  if (characterLength(value) > MAX_TITLE_CHARACTERS) {
    throw new Error(`${path} exceeds ${MAX_TITLE_CHARACTERS} characters`)
  }
  if (/^["']|["']$/u.test(value)) {
    throw new Error(`${path} must not start or end with a quote`)
  }
  return value
}

function validateProjection(value, path) {
  const projection = requireRecord(value, path)
  requireExactKeys(projection, projectionKeys, path)

  const agent = requireString(projection.agent, `${path}.agent`, { nonEmpty: true })
  if (agent !== 'claude' && agent !== 'codex') {
    throw new Error(`${path}.agent must be claude or codex`)
  }
  requireString(projection.title, `${path}.title`, { nonEmpty: true })
  requireNullableString(projection.titleJson, `${path}.titleJson`)
  requireNullableString(projection.summaryText, `${path}.summaryText`)
  requireString(projection.searchText, `${path}.searchText`)
  for (const key of [
    'messageCount',
    'toolCallCount',
    'fileCount',
    'additions',
    'deletions',
    'qualityScore',
    'publishedAt',
    'updatedAt',
  ]) {
    requireNumber(projection[key], `${path}.${key}`, { integer: true, nonNegative: true })
  }
  requireNullableString(projection.lineageSourceSid, `${path}.lineageSourceSid`)
  requireNullableNumber(projection.costUsd, `${path}.costUsd`, { nonNegative: true })
  requireNullableNumber(projection.totalTokens, `${path}.totalTokens`, {
    integer: true,
    nonNegative: true,
  })
  return projection
}

export function buildCanonicalNote(titles, summaryBodyMd) {
  return `---\ntitle: ${titles.en}\ntitle_zh: ${titles.zh}\n---\n\n${summaryBodyMd}`
}

function desiredProjection(expectedProjection, replacement, titles, summaryBodyMd, path) {
  if (expectedProjection === null) {
    if (replacement !== null) throw new Error(`${path} must be null for a non-Public Session`)
    return null
  }

  const value = requireRecord(replacement, path)
  requireExactKeys(value, ['qualityScore', 'searchText'], path)
  const qualityScore = requireNumber(value.qualityScore, `${path}.qualityScore`, {
    integer: true,
    nonNegative: true,
  })
  const searchText = requireString(value.searchText, `${path}.searchText`, { nonEmpty: true })
  if (encoder.encode(searchText).byteLength > MAX_SEARCH_BYTES) {
    throw new Error(`${path}.searchText exceeds ${MAX_SEARCH_BYTES} UTF-8 bytes`)
  }
  if (searchText !== searchText.toLowerCase()) {
    throw new Error(`${path}.searchText must be normalized to lower case`)
  }

  const summaryText = boundCharacters(markdownToPlainText(summaryBodyMd), MAX_SUMMARY_CHARACTERS)
  if (!summaryText) throw new Error(`${path} requires a non-empty projected summary`)
  const searchPrefix = [titles.en, titles.zh, summaryText]
    .map((part) => collapseWhitespace(part).toLowerCase())
    .join(' ')
  if (!searchText.startsWith(searchPrefix)) {
    throw new Error(`${path}.searchText must start with the bilingual titles and summary`)
  }

  return {
    ...expectedProjection,
    qualityScore,
    searchText,
    summaryText,
    title: titles.en,
    titleJson: JSON.stringify(titles),
  }
}

export function validateMapping(value) {
  const mapping = requireRecord(value, 'mapping')
  requireExactKeys(mapping, ['sessions', 'target', 'version'], 'mapping')
  if (mapping.version !== 1) throw new Error('mapping.version must be 1')

  const target = requireRecord(mapping.target, 'mapping.target')
  requireExactKeys(
    target,
    ['accountId', 'databaseId', 'databaseName', 'migration'],
    'mapping.target',
  )
  for (const key of Object.keys(TARGET)) {
    if (target[key] !== TARGET[key])
      throw new Error(`mapping.target.${key} is not the fixed target`)
  }

  if (!Array.isArray(mapping.sessions) || mapping.sessions.length !== EXPECTED_LIVE_SESSIONS) {
    throw new Error(`mapping.sessions must contain exactly ${EXPECTED_LIVE_SESSIONS} entries`)
  }

  const seen = new Set()
  const sessions = mapping.sessions.map((rawEntry, index) => {
    const path = `mapping.sessions[${index}]`
    const entry = requireRecord(rawEntry, path)
    requireExactKeys(entry, ['expected', 'replacement', 'sid'], path)
    const sid = requireString(entry.sid, `${path}.sid`, { nonEmpty: true })
    if (!SID_RE.test(sid)) throw new Error(`${path}.sid is invalid`)
    if (seen.has(sid)) throw new Error(`${path}.sid is duplicated`)
    seen.add(sid)

    const expected = requireRecord(entry.expected, `${path}.expected`)
    requireExactKeys(
      expected,
      [
        'noteMd',
        'noteSha256',
        'projection',
        'root',
        'teamId',
        'updatedAt',
        'visibility',
        'withdrawnAt',
      ],
      `${path}.expected`,
    )
    const root = requireString(expected.root, `${path}.expected.root`, { nonEmpty: true })
    if (!ROOT_RE.test(root)) throw new Error(`${path}.expected.root must be a SHA-256`)
    const updatedAt = requireNumber(expected.updatedAt, `${path}.expected.updatedAt`, {
      integer: true,
      nonNegative: true,
    })
    const visibility = requireString(expected.visibility, `${path}.expected.visibility`)
    if (visibility !== 'unlisted' && visibility !== 'private') {
      throw new Error(`${path}.expected.visibility is invalid`)
    }
    const teamId = requireNullableString(expected.teamId, `${path}.expected.teamId`)
    if (teamId !== null && !TEAM_ID_RE.test(teamId)) {
      throw new Error(`${path}.expected.teamId is invalid`)
    }
    if (expected.withdrawnAt !== null) {
      throw new Error(`${path}.expected.withdrawnAt must be null for a live Session`)
    }
    const noteMd = requireNullableString(expected.noteMd, `${path}.expected.noteMd`)
    const expectedNoteSha = requireString(expected.noteSha256, `${path}.expected.noteSha256`, {
      nonEmpty: true,
    }).toLowerCase()
    if (!SHA256_RE.test(expectedNoteSha)) {
      throw new Error(`${path}.expected.noteSha256 must be a SHA-256`)
    }
    if (noteSha256(noteMd) !== expectedNoteSha) {
      throw new Error(`${path}.expected.noteSha256 does not match the full note preimage`)
    }
    const expectedProjection =
      expected.projection === null
        ? null
        : validateProjection(expected.projection, `${path}.expected.projection`)

    const replacement = requireRecord(entry.replacement, `${path}.replacement`)
    requireExactKeys(replacement, ['projection', 'summaryBodyMd', 'titles'], `${path}.replacement`)
    const titles = requireRecord(replacement.titles, `${path}.replacement.titles`)
    requireExactKeys(titles, ['en', 'zh'], `${path}.replacement.titles`)
    const normalizedTitles = {
      en: validateTitle(titles.en, `${path}.replacement.titles.en`),
      zh: validateTitle(titles.zh, `${path}.replacement.titles.zh`),
    }
    const summaryBodyMd = requireString(
      replacement.summaryBodyMd,
      `${path}.replacement.summaryBodyMd`,
      { nonEmpty: true },
    )
    if (summaryBodyMd !== summaryBodyMd.trim()) {
      throw new Error(`${path}.replacement.summaryBodyMd must be trimmed`)
    }
    const nextNoteMd = buildCanonicalNote(normalizedTitles, summaryBodyMd)
    if (nextNoteMd === noteMd) throw new Error(`${path}.replacement does not change note_md`)
    const nextProjection = desiredProjection(
      expectedProjection,
      replacement.projection,
      normalizedTitles,
      summaryBodyMd,
      `${path}.replacement.projection`,
    )

    if (expectedProjection !== null) {
      if (visibility !== 'unlisted' || teamId !== null) {
        throw new Error(`${path} has a Public projection on a non-Public Session`)
      }
      if (sid.startsWith('pi_')) {
        throw new Error(`${path} cannot publish a Pi Session to Discovery`)
      }
    }
    if (visibility === 'private' && teamId === null) {
      throw new Error(`${path} has private visibility without a Team`)
    }

    return {
      sid,
      expected: {
        noteMd,
        noteSha256: expectedNoteSha,
        projection: expectedProjection,
        root,
        teamId,
        updatedAt,
        visibility,
        withdrawnAt: null,
      },
      next: {
        noteMd: nextNoteMd,
        noteSha256: noteSha256(nextNoteMd),
        projection: nextProjection,
        summaryBodyMd,
        titles: normalizedTitles,
      },
    }
  })

  const projectionCount = sessions.filter((entry) => entry.expected.projection !== null).length
  if (projectionCount !== EXPECTED_PROJECTIONS) {
    throw new Error(`mapping must contain exactly ${EXPECTED_PROJECTIONS} Public projections`)
  }

  return {
    sessions: sessions.sort((left, right) => left.sid.localeCompare(right.sid)),
    target: { ...TARGET },
    version: 1,
  }
}

function scalarEqual(left, right) {
  return Object.is(left, right)
}

function assertProjectionEqual(actual, expected, path) {
  if ((actual === null) !== (expected === null)) {
    throw new Error(`${path} presence drifted`)
  }
  if (actual === null || expected === null) return
  for (const key of projectionKeys) {
    if (!scalarEqual(actual[key], expected[key])) {
      throw new Error(`${path}.${key} drifted`)
    }
  }
}

export function scopeCounts(rows) {
  const counts = { public: 0, linkOnly: 0, team: 0 }
  for (const row of rows) {
    if (row.withdrawnAt !== null)
      throw new Error('Remote snapshot unexpectedly contains withdrawn rows')
    if (row.visibility === 'unlisted' && row.teamId === null && row.projection !== null) {
      counts.public += 1
    } else if (row.visibility === 'unlisted' && row.teamId === null && row.projection === null) {
      counts.linkOnly += 1
    } else if (row.visibility === 'private' && row.teamId !== null && row.projection === null) {
      counts.team += 1
    } else {
      throw new Error('Remote snapshot has an unsupported visibility/projection combination')
    }
  }
  return counts
}

function validateFixedCounts(rows) {
  if (rows.length !== EXPECTED_LIVE_SESSIONS) {
    throw new Error(
      `Remote live Session count drifted: expected ${EXPECTED_LIVE_SESSIONS}, received ${rows.length}`,
    )
  }
  const uniqueSids = new Set(rows.map((row) => row.sid))
  if (uniqueSids.size !== rows.length) throw new Error('Remote snapshot contains duplicate SIDs')
  const projectionCount = rows.filter((row) => row.projection !== null).length
  if (projectionCount !== EXPECTED_PROJECTIONS) {
    throw new Error(
      `Remote projection count drifted: expected ${EXPECTED_PROJECTIONS}, received ${projectionCount}`,
    )
  }
  const scopes = scopeCounts(rows)
  for (const key of Object.keys(EXPECTED_SCOPES)) {
    if (scopes[key] !== EXPECTED_SCOPES[key]) {
      throw new Error(
        `Remote ${key} count drifted: expected ${EXPECTED_SCOPES[key]}, received ${scopes[key]}`,
      )
    }
  }
  return scopes
}

export function validateSnapshotAgainstMapping(rows, mapping) {
  const scopes = validateFixedCounts(rows)
  const remoteBySid = new Map(rows.map((row) => [row.sid, row]))
  if (remoteBySid.size !== mapping.sessions.length) {
    throw new Error('Remote Session set does not match the mapping')
  }

  for (const entry of mapping.sessions) {
    const remote = remoteBySid.get(entry.sid)
    if (!remote) throw new Error('A mapped Session is absent from the remote snapshot')
    for (const key of ['root', 'updatedAt', 'visibility', 'teamId', 'withdrawnAt']) {
      if (!scalarEqual(remote[key], entry.expected[key])) {
        throw new Error(`Session preimage ${key} drifted`)
      }
    }
    const remoteNoteSha = noteSha256(remote.noteMd)
    if (remoteNoteSha !== entry.expected.noteSha256 || remote.noteMd !== entry.expected.noteMd) {
      throw new Error(`Session note preimage drifted (remote sha256 ${remoteNoteSha})`)
    }
    assertProjectionEqual(remote.projection, entry.expected.projection, 'Projection preimage')
  }

  return scopes
}

function sqlLiteral(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot encode a non-finite SQL number')
    return String(value)
  }
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  throw new Error(`Cannot encode SQL value of type ${typeof value}`)
}

function casWhereForSession(entry, expectedNoteMd) {
  return [
    `sid IS ${sqlLiteral(entry.sid)}`,
    `root IS ${sqlLiteral(entry.expected.root)}`,
    `updated_at IS ${sqlLiteral(entry.expected.updatedAt)}`,
    `visibility IS ${sqlLiteral(entry.expected.visibility)}`,
    `team_id IS ${sqlLiteral(entry.expected.teamId)}`,
    'withdrawn_at IS NULL',
    `note_md IS ${sqlLiteral(expectedNoteMd)}`,
  ].join('\n  AND ')
}

const projectionColumns = Object.freeze({
  additions: 'additions',
  agent: 'agent',
  costUsd: 'cost_usd',
  deletions: 'deletions',
  fileCount: 'file_count',
  lineageSourceSid: 'lineage_source_sid',
  messageCount: 'message_count',
  publishedAt: 'published_at',
  qualityScore: 'quality_score',
  searchText: 'search_text',
  summaryText: 'summary_text',
  title: 'title',
  titleJson: 'title_json',
  toolCallCount: 'tool_call_count',
  totalTokens: 'total_tokens',
  updatedAt: 'updated_at',
})

function casWhereForProjection(sid, projection) {
  return [
    `sid IS ${sqlLiteral(sid)}`,
    ...projectionKeys.map((key) => `${projectionColumns[key]} IS ${sqlLiteral(projection[key])}`),
  ].join('\n  AND ')
}

function mutationGuard() {
  return "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('spool-cas-guard', '$') END;"
}

function absenceGuard(sid) {
  return (
    'SELECT CASE WHEN NOT EXISTS (' +
    `SELECT 1 FROM hub_session_discovery WHERE sid IS ${sqlLiteral(sid)}` +
    ") THEN 1 ELSE json_extract('spool-cas-guard', '$') END;"
  )
}

function liveInventoryGuard(mapping, phase) {
  const mappedSids = mapping.sessions.map((entry) => sqlLiteral(entry.sid)).join(', ')
  return [
    `-- Exact live inventory guard (${phase}).`,
    'SELECT CASE WHEN',
    `  (SELECT COUNT(*) FROM hub_sessions WHERE withdrawn_at IS NULL) = ${EXPECTED_LIVE_SESSIONS}`,
    '  AND NOT EXISTS (',
    '    SELECT 1 FROM hub_sessions',
    '    WHERE withdrawn_at IS NULL',
    `      AND sid NOT IN (${mappedSids})`,
    '  )',
    '  AND (',
    '    SELECT COUNT(*)',
    '    FROM hub_session_discovery projection',
    '    JOIN hub_sessions session ON session.sid=projection.sid',
    '    WHERE session.withdrawn_at IS NULL',
    `  ) = ${EXPECTED_PROJECTIONS}`,
    "THEN 1 ELSE json_extract('spool-inventory-guard', '$') END;",
  ].join('\n')
}

export function buildMutationSql(mapping, direction, metadata = {}) {
  if (direction !== 'apply' && direction !== 'rollback') {
    throw new Error('Mutation direction must be apply or rollback')
  }
  const lines = [
    '-- Generated by backfill-session-titles.mjs.',
    '-- This file contains private Session summaries; keep mode 0600.',
    '-- D1 remote file imports are atomic; every mutation is guarded by an exact preimage.',
  ]
  if (metadata.mappingSha256) lines.push(`-- mapping-sha256: ${metadata.mappingSha256}`)
  if (metadata.backupSha256) lines.push(`-- backup-sha256: ${metadata.backupSha256}`)
  lines.push('', liveInventoryGuard(mapping, `before ${direction}`), '')

  mapping.sessions.forEach((entry, index) => {
    const beforeNote = direction === 'apply' ? entry.expected.noteMd : entry.next.noteMd
    const afterNote = direction === 'apply' ? entry.next.noteMd : entry.expected.noteMd
    const beforeProjection =
      direction === 'apply' ? entry.expected.projection : entry.next.projection
    const afterProjection =
      direction === 'apply' ? entry.next.projection : entry.expected.projection

    lines.push(`-- Session ${index + 1} of ${mapping.sessions.length}`)
    lines.push(
      `UPDATE hub_sessions\nSET note_md = ${sqlLiteral(afterNote)}\nWHERE ${casWhereForSession(
        entry,
        beforeNote,
      )};`,
    )
    lines.push(mutationGuard())

    if (beforeProjection === null || afterProjection === null) {
      if (beforeProjection !== afterProjection) {
        throw new Error('Backfill may not add or remove a Discovery projection')
      }
      lines.push(absenceGuard(entry.sid))
    } else {
      lines.push(
        `UPDATE hub_session_discovery\nSET title = ${sqlLiteral(afterProjection.title)},\n` +
          `    title_json = ${sqlLiteral(afterProjection.titleJson)},\n` +
          `    summary_text = ${sqlLiteral(afterProjection.summaryText)},\n` +
          `    search_text = ${sqlLiteral(afterProjection.searchText)},\n` +
          `    quality_score = ${sqlLiteral(afterProjection.qualityScore)}\n` +
          `WHERE ${casWhereForProjection(entry.sid, beforeProjection)};`,
      )
      lines.push(mutationGuard())
    }
    lines.push('')
  })

  lines.push(liveInventoryGuard(mapping, `after ${direction}`), '')
  return `${lines.join('\n')}\n`
}

function buildReverseMapping(mapping, metadata) {
  return {
    version: 1,
    kind: 'spool-session-title-backfill-reverse-map',
    warning: 'Sensitive production preimages. Keep this file mode 0600.',
    generatedAt: new Date().toISOString(),
    target: { ...TARGET },
    metadata,
    sessions: mapping.sessions.map((entry) => ({
      sid: entry.sid,
      before: {
        ...entry.expected,
        projection: entry.expected.projection,
      },
      after: {
        root: entry.expected.root,
        updatedAt: entry.expected.updatedAt,
        visibility: entry.expected.visibility,
        teamId: entry.expected.teamId,
        withdrawnAt: null,
        noteMd: entry.next.noteMd,
        noteSha256: entry.next.noteSha256,
        projection: entry.next.projection,
      },
    })),
  }
}

export function verifyPostState(rows, mapping) {
  const scopes = validateFixedCounts(rows)
  const remoteBySid = new Map(rows.map((row) => [row.sid, row]))
  let bilingualTitles = 0
  let summaries = 0
  let projections = 0

  for (const entry of mapping.sessions) {
    const remote = remoteBySid.get(entry.sid)
    if (!remote) throw new Error('A mapped Session is absent after apply')
    for (const key of ['root', 'updatedAt', 'visibility', 'teamId', 'withdrawnAt']) {
      if (!scalarEqual(remote[key], entry.expected[key])) {
        throw new Error(`Post-apply Session ${key} changed unexpectedly`)
      }
    }
    if (
      remote.noteMd !== entry.next.noteMd ||
      noteSha256(remote.noteMd) !== entry.next.noteSha256
    ) {
      throw new Error('Post-apply canonical note does not match the reviewed replacement')
    }
    const canonicalPrefix =
      `---\ntitle: ${entry.next.titles.en}\n` + `title_zh: ${entry.next.titles.zh}\n---\n\n`
    if (!remote.noteMd.startsWith(canonicalPrefix)) {
      throw new Error('Post-apply canonical note is missing its bilingual title front matter')
    }
    bilingualTitles += 1
    if (!entry.next.summaryBodyMd.trim()) {
      throw new Error('Post-apply canonical note has an empty summary')
    }
    summaries += 1
    assertProjectionEqual(remote.projection, entry.next.projection, 'Post-apply projection')
    if (remote.projection !== null) projections += 1
  }

  if (bilingualTitles !== EXPECTED_LIVE_SESSIONS || summaries !== EXPECTED_LIVE_SESSIONS) {
    throw new Error('Post-apply title/summary totals are incomplete')
  }
  if (projections !== EXPECTED_PROJECTIONS) {
    throw new Error('Post-apply projection total is incomplete')
  }
  return { bilingualTitles, projections, scopes, summaries }
}

function normalizeRemoteProjection(row) {
  if (row.projection_sid === null) return null
  return {
    additions: row.projection_additions,
    agent: row.projection_agent,
    costUsd: row.projection_cost_usd,
    deletions: row.projection_deletions,
    fileCount: row.projection_file_count,
    lineageSourceSid: row.projection_lineage_source_sid,
    messageCount: row.projection_message_count,
    publishedAt: row.projection_published_at,
    qualityScore: row.projection_quality_score,
    searchText: row.projection_search_text,
    summaryText: row.projection_summary_text,
    title: row.projection_title,
    titleJson: row.projection_title_json,
    toolCallCount: row.projection_tool_call_count,
    totalTokens: row.projection_total_tokens,
    updatedAt: row.projection_updated_at,
  }
}

function normalizeRemoteRows(rows) {
  if (!Array.isArray(rows)) throw new Error('Wrangler returned an invalid Session snapshot')
  return rows.map((row) => ({
    noteMd: row.note_md,
    projection: normalizeRemoteProjection(row),
    root: row.root,
    sid: row.sid,
    teamId: row.team_id,
    updatedAt: row.updated_at,
    visibility: row.visibility,
    withdrawnAt: row.withdrawn_at,
  }))
}

const remoteSnapshotSql = `
SELECT
  s.sid,
  s.root,
  s.updated_at,
  s.visibility,
  s.team_id,
  s.withdrawn_at,
  s.note_md,
  d.sid AS projection_sid,
  d.agent AS projection_agent,
  d.title AS projection_title,
  d.title_json AS projection_title_json,
  d.summary_text AS projection_summary_text,
  d.search_text AS projection_search_text,
  d.message_count AS projection_message_count,
  d.tool_call_count AS projection_tool_call_count,
  d.file_count AS projection_file_count,
  d.additions AS projection_additions,
  d.deletions AS projection_deletions,
  d.lineage_source_sid AS projection_lineage_source_sid,
  d.quality_score AS projection_quality_score,
  d.published_at AS projection_published_at,
  d.updated_at AS projection_updated_at,
  d.cost_usd AS projection_cost_usd,
  d.total_tokens AS projection_total_tokens
FROM hub_sessions s
LEFT JOIN hub_session_discovery d ON d.sid = s.sid
WHERE s.withdrawn_at IS NULL
ORDER BY s.sid;
`

async function writeSecureFile(path, contents) {
  await writeFile(path, contents, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function runWrangler(args, options = {}) {
  const child = spawn(process.execPath, [wranglerEntrypoint, ...args], {
    cwd: appDir,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: TARGET.accountId,
      NO_COLOR: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const code = await new Promise((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode) => resolveCode(exitCode ?? 1))
  })
  if (code !== 0) {
    if (options.sensitiveLogPath) {
      await writeSecureFile(options.sensitiveLogPath, `stdout:\n${stdout}\n\nstderr:\n${stderr}`)
      throw new Error(
        `wrangler failed with exit code ${code}; sensitive output was suppressed and saved to ${options.sensitiveLogPath}`,
      )
    }
    throw new Error(`wrangler failed with exit code ${code}\n${stdout}${stderr}`)
  }
  return { stderr, stdout }
}

function parseWranglerJson(stdout, label) {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`Wrangler returned invalid JSON for ${label}; response content was suppressed`)
  }
}

function flattenD1Results(payload, label) {
  if (!Array.isArray(payload)) throw new Error(`Wrangler returned an invalid ${label} payload`)
  return payload.flatMap((execution) =>
    Array.isArray(execution?.results) ? execution.results : [],
  )
}

async function remoteQuery(sql, artifactDir, label) {
  const failurePath = join(artifactDir, `${label}-wrangler-failure.log`)
  const { stdout } = await runWrangler(
    [
      'd1',
      'execute',
      TARGET.databaseName,
      '--remote',
      '--config',
      'wrangler.prod.toml',
      '--command',
      sql,
      '--json',
    ],
    { sensitiveLogPath: failurePath },
  )
  return flattenD1Results(parseWranglerJson(stdout, label), label)
}

async function verifyFixedTarget() {
  const configuredAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  if (configuredAccount && configuredAccount !== TARGET.accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID does not match the fixed production account')
  }

  const config = await readFile(productionConfigPath, 'utf8')
  for (const [field, value] of [
    ['database_name', TARGET.databaseName],
    ['database_id', TARGET.databaseId],
  ]) {
    const pattern = new RegExp(`^${field}\\s*=\\s*"${value}"\\s*$`, 'm')
    if (!pattern.test(config)) {
      throw new Error(`wrangler.prod.toml does not contain the fixed ${field}`)
    }
  }

  const { stdout } = await runWrangler([
    'd1',
    'info',
    TARGET.databaseName,
    '--config',
    'wrangler.prod.toml',
    '--json',
  ])
  const info = parseWranglerJson(stdout, 'D1 target info')
  if (info?.uuid !== TARGET.databaseId || info?.name !== TARGET.databaseName) {
    throw new Error('Remote D1 identity does not match the fixed production database')
  }
}

async function readPrivateMapping(mappingPath) {
  if (!isAbsolute(mappingPath)) throw new Error('--mapping must be an absolute path')
  const resolvedPath = await realpath(mappingPath)
  const repositoryRelative = relative(repoRoot, resolvedPath)
  if (
    repositoryRelative === '' ||
    (!repositoryRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      repositoryRelative !== '..' &&
      !isAbsolute(repositoryRelative))
  ) {
    throw new Error('The private mapping must live outside the repository')
  }

  const metadata = await stat(resolvedPath)
  if (!metadata.isFile()) throw new Error('--mapping must point to a regular file')
  if (metadata.size > MAX_MAPPING_BYTES) {
    throw new Error(`Mapping exceeds the ${MAX_MAPPING_BYTES}-byte safety limit`)
  }
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error(
      'The private mapping must not be readable or writable by group/other (chmod 600)',
    )
  }

  const bytes = await readFile(resolvedPath)
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Mapping is not valid JSON')
  }
  return {
    mapping: validateMapping(value),
    mappingSha256: sha256(bytes),
  }
}

async function exportBackup(artifactDir) {
  const backupPath = join(artifactDir, 'production-backup.sql')
  await runWrangler([
    'd1',
    'export',
    TARGET.databaseName,
    '--remote',
    '--config',
    'wrangler.prod.toml',
    '--output',
    backupPath,
    '--skip-confirmation',
  ])
  await chmod(backupPath, 0o600)
  const backup = await readFile(backupPath)
  if (backup.length === 0) throw new Error('Remote D1 export produced an empty backup')
  return {
    backupPath,
    backupSha256: sha256(backup),
    backupSizeBytes: backup.length,
  }
}

async function verifyMigration(artifactDir) {
  const rows = await remoteQuery(
    `SELECT name FROM d1_migrations WHERE name = '${TARGET.migration}';`,
    artifactDir,
    'migration-check',
  )
  if (rows.length !== 1 || rows[0]?.name !== TARGET.migration) {
    throw new Error(`Required migration ${TARGET.migration} is not applied exactly once`)
  }
}

async function readRemoteSnapshot(artifactDir, label) {
  const rows = await remoteQuery(remoteSnapshotSql, artifactDir, label)
  return normalizeRemoteRows(rows)
}

function logReview({ apply, artifactDir, backup, mappingSha256, scopes, sql }) {
  console.log(`[session-title-backfill] mode: ${apply ? 'APPLY' : 'dry-run (no writes)'}`)
  console.log(`[session-title-backfill] mapping sha256: ${mappingSha256}`)
  console.log(
    `[session-title-backfill] backup: ${backup.backupSizeBytes} bytes, sha256 ${backup.backupSha256}`,
  )
  console.log(
    `[session-title-backfill] reviewed: ${EXPECTED_LIVE_SESSIONS} live Sessions, ` +
      `${EXPECTED_PROJECTIONS} projections, scopes ${scopes.public}/${scopes.linkOnly}/${scopes.team}`,
  )
  console.log(
    `[session-title-backfill] planned: ${EXPECTED_LIVE_SESSIONS} canonical notes, ` +
      `${EXPECTED_LIVE_SESSIONS} bilingual titles, ${EXPECTED_PROJECTIONS} projection updates`,
  )
  console.log(`[session-title-backfill] apply SQL sha256: ${sql.applySha256}`)
  console.log(`[session-title-backfill] rollback SQL sha256: ${sql.rollbackSha256}`)
  console.log(`[session-title-backfill] secure artifacts (0700): ${artifactDir}`)
  console.log('[session-title-backfill] summary/title bodies were intentionally not printed')
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return
  }

  assertNode22()
  process.umask(0o077)
  await stat(wranglerEntrypoint)
  const { mapping, mappingSha256 } = await readPrivateMapping(options.mappingPath)
  if (options.mappingSha !== null && options.mappingSha !== mappingSha256) {
    throw new Error('--mapping-sha does not match the exact mapping bytes')
  }

  await verifyFixedTarget()
  const artifactDir = await mkdtemp(join(tmpdir(), 'spool-session-title-backfill-'))
  await chmod(artifactDir, 0o700)

  const backup = await exportBackup(artifactDir)
  await verifyMigration(artifactDir)
  const beforeRows = await readRemoteSnapshot(artifactDir, 'preflight-snapshot')
  const scopes = validateSnapshotAgainstMapping(beforeRows, mapping)

  const sqlMetadata = {
    backupSha256: backup.backupSha256,
    mappingSha256,
  }
  const applySql = buildMutationSql(mapping, 'apply', sqlMetadata)
  const rollbackSql = buildMutationSql(mapping, 'rollback', sqlMetadata)
  const applyPath = join(artifactDir, 'apply.sql')
  const rollbackPath = join(artifactDir, 'rollback.sql')
  const reverseMappingPath = join(artifactDir, 'reverse-mapping.json')
  await writeSecureFile(applyPath, applySql)
  await writeSecureFile(rollbackPath, rollbackSql)
  const applySha256 = sha256(applySql)
  const rollbackSha256 = sha256(rollbackSql)
  await writeSecureFile(
    reverseMappingPath,
    `${JSON.stringify(
      buildReverseMapping(mapping, {
        applySha256,
        backupSha256: backup.backupSha256,
        mappingSha256,
        rollbackSha256,
      }),
      null,
      2,
    )}\n`,
  )

  logReview({
    apply: options.apply,
    artifactDir,
    backup,
    mappingSha256,
    scopes,
    sql: { applySha256, rollbackSha256 },
  })

  if (!options.apply) {
    console.log(
      '[session-title-backfill] dry-run complete; rerun with --apply and the printed mapping SHA',
    )
    return
  }

  await runWrangler(
    [
      'd1',
      'execute',
      TARGET.databaseName,
      '--remote',
      '--config',
      'wrangler.prod.toml',
      '--file',
      applyPath,
      '--yes',
    ],
    { sensitiveLogPath: join(artifactDir, 'apply-wrangler-failure.log') },
  )

  const afterRows = await readRemoteSnapshot(artifactDir, 'post-apply-snapshot')
  const verified = verifyPostState(afterRows, mapping)
  console.log(
    `[session-title-backfill] apply verified: ${verified.bilingualTitles}/9 bilingual titles, ` +
      `${verified.summaries}/9 summaries, ${verified.projections}/7 projections, ` +
      `scopes ${verified.scopes.public}/${verified.scopes.linkOnly}/${verified.scopes.team}`,
  )
  console.log(
    `[session-title-backfill] guarded rollback remains at ${rollbackPath} ` +
      `(sha256 ${rollbackSha256}); the full export is ${backup.backupPath}`,
  )
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unknown failure'
    console.error(`[session-title-backfill] ${message}`)
    process.exitCode = 1
  })
}
