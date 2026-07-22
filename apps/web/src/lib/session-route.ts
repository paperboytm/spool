/* Derive the public "route map" from provider-native hub records.
 *
 * Raw records remain the source of machine evidence (tool/check/error counts).
 * When a curated .spool document is rendered, project the authored labels and
 * anchors through that document before exposing the route: this keeps selected
 * turns and redaction rules authoritative while retaining the raw evidence. */

import type { SpoolDocument } from '@spool/share-kit'
import { collectRedactList, redactPlainText, selectSegments } from '@spool/share-kit/timeline'

import type { HubRecordLine } from './hub-api'

export interface RoutePhase {
  /** Record index of the steering prompt — jump anchor for legacy sessions. */
  recordIndex: number
  /** Original .spool turn index when the route is projected onto a publication. */
  turnIndex?: number
  /** Provider timestamp, used to align raw prompts with curated turns. */
  timestamp: string | null
  /** False only for the synthetic phase used when tools precede the first prompt. */
  isPrompt: boolean
  label: string
  tools: number
  edits: number
  commands: number
  agents: number
  /** Non-check tool failures inside this phase. */
  errors: number
  checkRuns: number
  /** Failed check commands. Kept separate from errors so the UI counts once. */
  checkFails: number
}

export interface SessionRoute {
  goal: string | null
  phases: RoutePhase[]
  /** Unique failed tool calls, including failed checks. */
  totalErrors: number
  prUrl: string | null
  prLabel: string | null
}

const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'apply_patch'])
const AGENT_TOOLS = new Set(['agent', 'task', 'spawn_agent', 'spawn-agent'])
const COMMAND_TOOLS = new Set([
  'bash',
  'shell',
  'command',
  'exec',
  'exec_command',
  'run_command',
  'terminal',
])
const CHECK_CMD = /\b(?:test|vitest|jest|pytest|typecheck|tsc|lint|check|build)\b/i
const MAX_LABEL = 64

type UnknownRecord = Record<string, unknown>

interface PromptDetails {
  text: string
  timestamp: string | null
}

interface ToolCallDetails {
  id: string | null
  name: string
  command: string
}

interface ToolResultDetails {
  id: string | null
  failed: boolean
  checkFailed: boolean
  pr: { prUrl: string; prLabel: string } | null
}

interface PendingCall {
  phase: RoutePhase
  isCheck: boolean
  createsPr: boolean
}

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringAt(record: UnknownRecord | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function objectAt(record: UnknownRecord | null, key: string): UnknownRecord | null {
  const value = record?.[key]
  return isObject(value) ? value : null
}

function contentText(content: unknown, acceptedTypes: readonly string[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const accepted = new Set(acceptedTypes)
  return content
    .filter(isObject)
    .filter((entry) => accepted.has(stringAt(entry, 'type') ?? ''))
    .map((entry) => stringAt(entry, 'text') ?? '')
    .filter(Boolean)
    .join('\n')
}

function cleanPrompt(text: string): string | null {
  const administrativeTags = [
    'spool-system-prelude',
    'local-command-stdout',
    'local-command-caveat',
    'system-reminder',
    'command-name',
    'command-message',
    'command-args',
  ]
  let trimmed = text.trim()
  for (const tag of administrativeTags) {
    trimmed = trimmed.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  trimmed = trimmed.trim()
  if (!trimmed || /^<task-notification\b[^>]*>/i.test(trimmed)) return null
  // Codex persists injected workspace instructions as a user-role response
  // item. event_msg is preferred when present, but old response-only sessions
  // still need this guard.
  if (/^# AGENTS\.md instructions for\s/i.test(trimmed)) return null
  return trimmed
}

function claudePrompt(record: UnknownRecord): PromptDetails | null {
  if (record['type'] !== 'user' || record['isSidechain'] === true) return null
  const message = objectAt(record, 'message')
  const content = message?.['content']
  if (
    Array.isArray(content) &&
    content.some((entry) => isObject(entry) && entry['type'] === 'tool_result')
  ) {
    return null
  }
  const text = cleanPrompt(contentText(content, ['text']))
  if (text === null) return null
  return { text, timestamp: stringAt(record, 'timestamp') }
}

function codexPrompt(record: UnknownRecord, preferEventMessages: boolean): PromptDetails | null {
  const payload = objectAt(record, 'payload')
  if (record['type'] === 'event_msg' && payload?.['type'] === 'user_message') {
    const text = cleanPrompt(stringAt(payload, 'message') ?? '')
    return text === null ? null : { text, timestamp: stringAt(record, 'timestamp') }
  }
  if (
    preferEventMessages ||
    record['type'] !== 'response_item' ||
    payload?.['type'] !== 'message' ||
    payload['role'] !== 'user'
  ) {
    return null
  }
  const text = cleanPrompt(contentText(payload['content'], ['input_text', 'text']))
  return text === null ? null : { text, timestamp: stringAt(record, 'timestamp') }
}

function promptOf(record: UnknownRecord, preferCodexEvents: boolean): PromptDetails | null {
  return claudePrompt(record) ?? codexPrompt(record, preferCodexEvents)
}

function labelOf(text: string): string {
  const firstLine = (text.split('\n').find((line) => line.trim()) ?? text).trim()
  return firstLine.length <= MAX_LABEL
    ? firstLine
    : `${firstLine.slice(0, MAX_LABEL - 1).trimEnd()}…`
}

function parseInput(input: unknown): UnknownRecord | null {
  if (isObject(input)) return input
  if (typeof input !== 'string') return null
  try {
    const parsed = JSON.parse(input) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function commandFromInput(input: unknown): string {
  const parsed = parseInput(input)
  if (parsed !== null) {
    return (
      stringAt(parsed, 'command') ?? stringAt(parsed, 'cmd') ?? stringAt(parsed, 'script') ?? ''
    )
  }
  return typeof input === 'string' ? input : ''
}

function claudeToolCalls(record: UnknownRecord): ToolCallDetails[] {
  if (record['type'] !== 'assistant') return []
  const message = objectAt(record, 'message')
  if (!Array.isArray(message?.['content'])) return []
  return message['content'].flatMap((entry) => {
    if (!isObject(entry) || entry['type'] !== 'tool_use') return []
    const name = stringAt(entry, 'name') ?? ''
    const input = entry['input']
    return [
      {
        id: stringAt(entry, 'id'),
        name,
        command: commandFromInput(input),
      },
    ]
  })
}

function codexToolCalls(record: UnknownRecord): ToolCallDetails[] {
  if (record['type'] !== 'response_item') return []
  const payload = objectAt(record, 'payload')
  if (
    payload === null ||
    (payload['type'] !== 'function_call' && payload['type'] !== 'custom_tool_call')
  ) {
    return []
  }
  const name = stringAt(payload, 'name') ?? ''
  const input = payload['arguments'] ?? payload['input']
  return [
    {
      id: stringAt(payload, 'call_id') ?? stringAt(payload, 'id'),
      name,
      command: commandFromInput(input),
    },
  ]
}

function toolCalls(record: UnknownRecord): ToolCallDetails[] {
  return [...claudeToolCalls(record), ...codexToolCalls(record)]
}

function outputExitCode(value: unknown): number | null {
  if (isObject(value)) {
    const direct = value['exit_code']
    if (typeof direct === 'number') return direct
    const metadata = objectAt(value, 'metadata')
    const nested = metadata?.['exit_code']
    if (typeof nested === 'number') return nested
    return null
  }
  if (typeof value === 'string') {
    try {
      return outputExitCode(JSON.parse(value) as unknown)
    } catch {
      const explicit = value.match(
        /(?:process exited with code|exit(?:ed)?(?: code)?[:=]?)[\s`]*(\d+)/i,
      )
      if (explicit?.[1]) return Number(explicit[1])
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isObject(entry)) continue
      const code = outputExitCode(stringAt(entry, 'text'))
      if (code !== null) return code
    }
  }
  return null
}

function outputSignalsFailure(value: unknown): boolean {
  const exitCode = outputExitCode(value)
  if (exitCode !== null) return exitCode !== 0
  if (typeof value === 'string') return /^\s*(?:script|command|tool) failed\b/i.test(value)
  if (Array.isArray(value)) {
    return value.some(
      (entry) => isObject(entry) && outputSignalsFailure(stringAt(entry, 'text') ?? ''),
    )
  }
  return false
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .filter(isObject)
      .map((entry) => stringAt(entry, 'text') ?? '')
      .filter(Boolean)
      .join('\n')
  }
  if (isObject(value)) {
    return [stringAt(value, 'stdout'), stringAt(value, 'stderr'), stringAt(value, 'output')]
      .filter((part): part is string => part !== null)
      .join('\n')
  }
  return ''
}

function outputSignalsCheckFailure(value: unknown): boolean {
  if (outputSignalsFailure(value)) return true
  const text = outputText(value)
  return (
    /(?:^|\n)\s*(?:Test Files|Tests|Suites?)\s+\d+\s+failed\b/im.test(text) ||
    /(?:^|\n)\s*FAIL(?:ED)?\s+/m.test(text) ||
    /(?:^|\n).*\bELIFECYCLE\b.*\bfailed\b/im.test(text) ||
    /(?:^|\n).*\berror TS\d+:/i.test(text) ||
    /(?:^|\n).*\bFound \d+ errors?\b/i.test(text)
  )
}

function githubPr(value: string): { prUrl: string; prLabel: string } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== 'https://github.com' || url.username || url.password) return null
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/)
  if (match === null) return null
  const [, owner, repository, number] = match
  return {
    prUrl: `https://github.com/${owner}/${repository}/pull/${number}`,
    prLabel: `PR #${number} · ${owner}/${repository}`,
  }
}

function githubPrFromOutput(value: unknown): { prUrl: string; prLabel: string } | null {
  const match = outputText(value).match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+\/?/i)
  return match?.[0] ? githubPr(match[0]) : null
}

function claudeToolResults(record: UnknownRecord): ToolResultDetails[] {
  if (record['type'] !== 'user') return []
  const message = objectAt(record, 'message')
  if (!Array.isArray(message?.['content'])) return []
  return message['content'].flatMap((entry) => {
    if (!isObject(entry) || entry['type'] !== 'tool_result') return []
    const content = entry['content']
    const toolUseResult = record['toolUseResult']
    return [
      {
        id: stringAt(entry, 'tool_use_id'),
        failed:
          entry['is_error'] === true ||
          outputSignalsFailure(content) ||
          outputSignalsFailure(toolUseResult),
        checkFailed: outputSignalsCheckFailure(content) || outputSignalsCheckFailure(toolUseResult),
        pr: githubPrFromOutput(content) ?? githubPrFromOutput(toolUseResult),
      },
    ]
  })
}

function codexToolResults(record: UnknownRecord): ToolResultDetails[] {
  const payload = objectAt(record, 'payload')
  if (payload === null) return []
  const payloadType = payload['type']
  if (
    (record['type'] !== 'response_item' ||
      (payloadType !== 'function_call_output' && payloadType !== 'custom_tool_call_output')) &&
    (record['type'] !== 'event_msg' || payloadType !== 'patch_apply_end')
  ) {
    return []
  }
  const status = stringAt(payload, 'status')?.toLowerCase()
  const failed =
    payload['success'] === false ||
    payload['is_error'] === true ||
    status === 'failed' ||
    status === 'error' ||
    outputSignalsFailure(payload['output'])
  return [
    {
      id: stringAt(payload, 'call_id') ?? stringAt(payload, 'id'),
      failed,
      checkFailed: outputSignalsCheckFailure(payload['output']),
      pr: githubPrFromOutput(payload['output']),
    },
  ]
}

function toolResults(record: UnknownRecord): ToolResultDetails[] {
  return [...claudeToolResults(record), ...codexToolResults(record)]
}

function isCodexEventPrompt(record: UnknownRecord): boolean {
  const payload = objectAt(record, 'payload')
  return record['type'] === 'event_msg' && payload?.['type'] === 'user_message'
}

function capturePrLink(record: UnknownRecord): { prUrl: string; prLabel: string } | null {
  if (record['type'] !== 'pr-link') return null
  const rawUrl = stringAt(record, 'prUrl')
  return rawUrl === null ? null : githubPr(rawUrl)
}

export function deriveSessionRoute(records: readonly HubRecordLine[]): SessionRoute | null {
  const parsed = records.flatMap((line) => {
    try {
      const record = JSON.parse(line.data) as unknown
      return isObject(record) ? [{ line, record }] : []
    } catch {
      return []
    }
  })
  const preferCodexEvents = parsed.some(({ record }) => isCodexEventPrompt(record))

  let goal: string | null = null
  const phases: RoutePhase[] = []
  let current: RoutePhase | null = null
  let totalErrors = 0
  let prUrl: string | null = null
  let prLabel: string | null = null
  const pendingCalls = new Map<string, PendingCall>()
  const seenCalls = new Set<string>()
  const countedFailures = new Set<string>()

  const ensurePhase = (
    recordIndex: number,
    label: string,
    timestamp: string | null,
    isPrompt: boolean,
  ): RoutePhase => {
    const phase: RoutePhase = {
      recordIndex,
      timestamp,
      isPrompt,
      label,
      tools: 0,
      edits: 0,
      commands: 0,
      agents: 0,
      errors: 0,
      checkRuns: 0,
      checkFails: 0,
    }
    phases.push(phase)
    return phase
  }

  for (const { line, record } of parsed) {
    const pr = capturePrLink(record)
    if (pr !== null) {
      prUrl = pr.prUrl
      prLabel = pr.prLabel
      continue
    }

    const prompt = promptOf(record, preferCodexEvents)
    if (prompt !== null) {
      if (goal === null) goal = labelOf(prompt.text)
      current = ensurePhase(line.i, labelOf(prompt.text), prompt.timestamp, true)
      continue
    }

    for (const call of toolCalls(record)) {
      const callKey = call.id ?? `record:${line.i}`
      if (seenCalls.has(callKey)) continue
      seenCalls.add(callKey)
      const phase = current ?? (current = ensurePhase(line.i, 'Session start', null, false))
      phase.tools += 1
      const normalizedName = call.name.toLowerCase()
      if (EDIT_TOOLS.has(normalizedName)) phase.edits += 1
      else if (AGENT_TOOLS.has(normalizedName)) phase.agents += 1
      else if (COMMAND_TOOLS.has(normalizedName)) phase.commands += 1

      const isCheck = COMMAND_TOOLS.has(normalizedName) && CHECK_CMD.test(call.command)
      if (isCheck) phase.checkRuns += 1
      if (call.id !== null) {
        pendingCalls.set(call.id, {
          phase,
          isCheck,
          createsPr:
            COMMAND_TOOLS.has(normalizedName) &&
            /(?:^|\s)gh\s+pr\s+create(?:\s|$)/i.test(call.command),
        })
      }
    }

    let resultOffset = 0
    for (const result of toolResults(record)) {
      const pending = result.id === null ? null : (pendingCalls.get(result.id) ?? null)
      if (pending?.createsPr === true && result.pr !== null) {
        prUrl = result.pr.prUrl
        prLabel = result.pr.prLabel
      }
      const failed = result.failed || (pending?.isCheck === true && result.checkFailed)
      const failureKey = result.id ?? `record:${line.i}:result:${resultOffset}`
      resultOffset += 1
      if (!failed) continue
      if (countedFailures.has(failureKey)) continue
      countedFailures.add(failureKey)

      const phase = pending?.phase ?? current ?? ensurePhase(line.i, 'Session start', null, false)
      current ??= phase
      totalErrors += 1
      if (pending?.isCheck === true) phase.checkFails += 1
      else phase.errors += 1
    }
  }

  if (phases.length === 0) return null
  return { goal, phases, totalErrors, prUrl, prLabel }
}

/**
 * Replace raw authored labels with the exact visible .spool prompt projection
 * and attach TimelineBody turn indices. Hidden turns never leak through the
 * route, and clicks always target a turn that the publication actually shows.
 */
export function projectSessionRouteToSpool(
  route: SessionRoute | null,
  document: SpoolDocument,
): SessionRoute | null {
  const redactList = document.opts.redact
    ? collectRedactList(document.conversation.turns, document.opts)
    : []
  const visibleTurns = selectSegments(document.conversation, document.opts).turns
  const visibleIndices = new Set(visibleTurns.map((turn) => turn.origIndex))
  const promptTurns = document.conversation.turns.flatMap((turn, turnIndex) => {
    if (turn.role !== 'user' || !turn.body.trim()) return []
    const body = document.opts.redact ? redactPlainText(turn.body, redactList) : turn.body
    return [{ turnIndex, timestamp: turn.timestamp ?? null, label: labelOf(body) }]
  })
  const unusedPromptTurns = new Set(promptTurns.map((turn) => turn.turnIndex))
  const phases: RoutePhase[] = []

  if (route === null) {
    for (const promptTurn of promptTurns) {
      if (!visibleIndices.has(promptTurn.turnIndex)) continue
      phases.push({
        recordIndex: promptTurn.turnIndex,
        turnIndex: promptTurn.turnIndex,
        timestamp: promptTurn.timestamp,
        isPrompt: true,
        label: promptTurn.label,
        tools: 0,
        edits: 0,
        commands: 0,
        agents: 0,
        errors: 0,
        checkRuns: 0,
        checkFails: 0,
      })
    }
    if (phases.length === 0) return null
    return {
      goal: phases[0]?.label ?? null,
      phases,
      totalErrors: 0,
      prUrl: null,
      prLabel: null,
    }
  }

  for (const phase of route.phases) {
    if (!phase.isPrompt) continue

    let promptTurn =
      phase.timestamp === null
        ? undefined
        : promptTurns.find(
            (turn) => unusedPromptTurns.has(turn.turnIndex) && turn.timestamp === phase.timestamp,
          )
    promptTurn ??= promptTurns.find((turn) => unusedPromptTurns.has(turn.turnIndex))
    if (promptTurn === undefined) continue
    unusedPromptTurns.delete(promptTurn.turnIndex)
    if (!visibleIndices.has(promptTurn.turnIndex)) continue
    phases.push({
      ...phase,
      label: promptTurn.label,
      timestamp: promptTurn.timestamp,
      turnIndex: promptTurn.turnIndex,
    })
  }

  if (phases.length === 0) return null
  const goal = phases.find((phase) => phase.isPrompt)?.label ?? null
  return {
    ...route,
    goal,
    phases,
    totalErrors: phases.reduce((total, phase) => total + phase.errors + phase.checkFails, 0),
    // A raw PR record is outside the authored .spool selection/redaction
    // boundary. Only legacy raw readers may expose a validated PR outcome.
    prUrl: null,
    prLabel: null,
  }
}
