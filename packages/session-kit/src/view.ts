import { composeSessionDiff } from './diff.js'
import { extractEditEvents } from './edits.js'
import { PORTABLE_MESSAGE_TYPE } from './messages.js'
import type {
  EditEvent,
  SessionProvider,
  SessionRecord,
  SessionRecordsOptions,
  SessionViewV1,
  ViewIndexEntry,
  ViewRecordKind,
} from './types.js'

type UnknownRecord = Record<string, unknown>

interface RecordDetails {
  kind: ViewRecordKind
  text?: string
  tool?: string
  messageRole?: 'user' | 'assistant'
}

const EXCERPT_BYTES = 4 * 1024
const VIEW_BYTES = 8 * 1024 * 1024
const textEncoder = new TextEncoder()

export function deriveView(
  provider: SessionProvider,
  records: readonly SessionRecord[],
): SessionViewV1
export function deriveView(
  records: readonly SessionRecord[],
  options: SessionRecordsOptions,
): SessionViewV1
export function deriveView(
  first: SessionProvider | readonly SessionRecord[],
  second: readonly SessionRecord[] | SessionRecordsOptions,
): SessionViewV1 {
  const { provider, records, workspaceRoot } = normalizeArguments(first, second)
  const editEvents = extractEditEvents(records, {
    provider,
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  })
  const eventsByRecord = groupEventsByRecord(editEvents)
  const parsed = records.map(parseRecord)
  const index: ViewIndexEntry[] = []
  const outline: Array<{ i: number; excerpt: string }> = []
  let firstPrompt = ''
  let lastReply = ''

  for (let position = 0; position < records.length; position += 1) {
    const raw = records[position] as SessionRecord
    const data = typeof raw === 'string' ? raw : raw.data
    const recordIndex = typeof raw !== 'string' && 'i' in raw ? raw.i : position
    const record = parsed[position] ?? null
    const recordEvents = eventsByRecord.get(recordIndex) ?? []
    const details = classifyRecord(provider, record, recordEvents)
    const timestamp = stringAt(record, 'timestamp')
    const excerpt = details.text ? truncateUtf8(details.text.trim(), EXCERPT_BYTES) : ''
    const files = [...new Set(recordEvents.map((event) => event.path))]
    const entry: ViewIndexEntry = {
      i: recordIndex,
      kind: details.kind,
      size: textEncoder.encode(data).byteLength,
      ...(timestamp === undefined ? {} : { ts: timestamp }),
      ...(files.length === 1 ? { file: files[0] as string } : {}),
      ...(details.tool === undefined ? {} : { tool: details.tool }),
      ...(excerpt ? { excerpt } : {}),
    }
    index.push(entry)

    if (details.messageRole === 'user' && excerpt) {
      outline.push({ i: recordIndex, excerpt })
      if (!firstPrompt) firstPrompt = excerpt
    }
    if (details.messageRole === 'assistant' && excerpt) lastReply = excerpt
  }

  const diff = composeSessionDiff(editEvents)
  const view: SessionViewV1 = {
    v: 1,
    index,
    files: diff.files.map((file) => ({
      path: file.path,
      events: file.events,
      adds: file.adds,
      dels: file.dels,
    })),
    outline,
    firstPrompt,
    lastReply,
    diffstat: diff.diffstat,
  }

  if (textEncoder.encode(JSON.stringify(view)).byteLength > VIEW_BYTES) {
    throw new RangeError('Derived view exceeds the 8 MB wire limit')
  }
  return view
}

function normalizeArguments(
  first: SessionProvider | readonly SessionRecord[],
  second: readonly SessionRecord[] | SessionRecordsOptions,
): { provider: SessionProvider; records: readonly SessionRecord[]; workspaceRoot?: string } {
  if (typeof first === 'string') {
    return { provider: first, records: second as readonly SessionRecord[] }
  }
  const options = second as SessionRecordsOptions
  return {
    provider: options.provider,
    records: first,
    ...(options.workspaceRoot === undefined ? {} : { workspaceRoot: options.workspaceRoot }),
  }
}

function groupEventsByRecord(events: readonly EditEvent[]): Map<number, EditEvent[]> {
  const grouped = new Map<number, EditEvent[]>()
  for (const event of events) {
    const existing = grouped.get(event.recordIndex)
    if (existing) existing.push(event)
    else grouped.set(event.recordIndex, [event])
  }
  return grouped
}

function parseRecord(record: SessionRecord): UnknownRecord | null {
  const data = typeof record === 'string' ? record : record.data
  try {
    const parsed = JSON.parse(data) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function classifyRecord(
  provider: SessionProvider,
  record: UnknownRecord | null,
  editEvents: readonly EditEvent[],
): RecordDetails {
  if (!record) return { kind: 'other' }
  const details =
    record['type'] === PORTABLE_MESSAGE_TYPE
      ? classifyPortable(record)
      : provider === 'claude'
        ? classifyClaude(record)
        : provider === 'codex'
          ? classifyCodex(record)
          : { kind: 'other' as const }
  if (editEvents.length > 0) {
    const tool = editEvents[0]?.tool
    return { ...details, kind: 'edit', ...(tool === undefined ? {} : { tool }) }
  }
  return details
}

function classifyPortable(record: UnknownRecord): RecordDetails {
  const message = objectAt(record, 'message')
  const role = stringAt(message, 'role')
  const text = stringAt(message, 'content')
  const toolNames = message?.['toolNames']
  const tool = Array.isArray(toolNames)
    ? toolNames.find((name): name is string => typeof name === 'string')
    : undefined
  if (role === 'user') return { kind: 'user', messageRole: 'user', ...(text ? { text } : {}) }
  if (role === 'assistant') {
    return {
      kind: tool ? 'tool' : 'assistant',
      messageRole: 'assistant',
      ...(text ? { text } : {}),
      ...(tool ? { tool } : {}),
    }
  }
  return { kind: tool ? 'tool' : 'other', ...(text ? { text } : {}), ...(tool ? { tool } : {}) }
}

function classifyClaude(record: UnknownRecord): RecordDetails {
  const message = objectAt(record, 'message')
  const role = stringAt(message, 'role')
  const content = message?.['content']
  const text = claudeText(content)
  if (Array.isArray(content)) {
    const items = content.filter(isObject)
    if (items.some((item) => item['type'] === 'tool_result')) return { kind: 'tool' }
    const toolUse = items.find((item) => item['type'] === 'tool_use')
    if (toolUse) {
      const tool = stringAt(toolUse, 'name')
      return {
        kind: 'tool',
        ...(tool === undefined ? {} : { tool }),
        ...(role === 'assistant' && text ? { text, messageRole: 'assistant' as const } : {}),
      }
    }
  }
  if (role === 'user') {
    return { kind: 'user', messageRole: 'user', ...(text ? { text } : {}) }
  }
  if (role === 'assistant') {
    return { kind: 'assistant', messageRole: 'assistant', ...(text ? { text } : {}) }
  }
  if (record['type'] === 'summary') {
    const summary = stringAt(record, 'summary')
    return { kind: 'other', ...(summary ? { text: summary } : {}) }
  }
  return { kind: 'other' }
}

function classifyCodex(record: UnknownRecord): RecordDetails {
  const payload = objectAt(record, 'payload')
  if (!payload) return { kind: 'other' }
  const payloadType = stringAt(payload, 'type')
  if (payloadType === 'user_message') {
    const text = stringAt(payload, 'message')
    return { kind: 'user', messageRole: 'user', ...(text ? { text } : {}) }
  }
  if (payloadType === 'agent_message') {
    const text = stringAt(payload, 'message')
    return { kind: 'assistant', messageRole: 'assistant', ...(text ? { text } : {}) }
  }
  if (payloadType === 'custom_tool_call' || payloadType === 'function_call') {
    const tool = stringAt(payload, 'name')
    return { kind: 'tool', ...(tool === undefined ? {} : { tool }) }
  }
  if (
    payloadType === 'custom_tool_call_output' ||
    payloadType === 'function_call_output' ||
    payloadType === 'patch_apply_end'
  )
    return { kind: 'tool' }

  const role = stringAt(payload, 'role')
  const text = codexResponseText(payload['content'])
  if (role === 'user') return { kind: 'user', messageRole: 'user', ...(text ? { text } : {}) }
  if (role === 'assistant') {
    return { kind: 'assistant', messageRole: 'assistant', ...(text ? { text } : {}) }
  }
  return { kind: 'other' }
}

function claudeText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isObject)
    .filter((item) => item['type'] === 'text')
    .map((item) => stringAt(item, 'text') ?? '')
    .filter(Boolean)
    .join('\n')
}

function codexResponseText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(isObject)
    .filter(
      (item) =>
        item['type'] === 'output_text' || item['type'] === 'text' || item['type'] === 'input_text',
    )
    .map((item) => stringAt(item, 'text') ?? '')
    .filter(Boolean)
    .join('\n')
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (textEncoder.encode(value).byteLength <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (textEncoder.encode(value.slice(0, middle)).byteLength <= maxBytes) low = middle
    else high = middle - 1
  }
  if (low > 0) {
    const last = value.charCodeAt(low - 1)
    if (last >= 0xd800 && last <= 0xdbff) low -= 1
  }
  return value.slice(0, low)
}

function objectAt(source: UnknownRecord | null | undefined, key: string): UnknownRecord | null {
  const value = source?.[key]
  return isObject(value) ? value : null
}

function stringAt(source: UnknownRecord | null | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' ? value : undefined
}

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
