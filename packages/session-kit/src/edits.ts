import { sessionRecordData } from './records.js'
import type {
  EditEvent,
  EditTool,
  SessionProvider,
  SessionRecord,
  SessionRecordsOptions,
  TextReplacement,
} from './types.js'

type UnknownRecord = Record<string, unknown>

interface PendingCall {
  recordIndex: number
  record: UnknownRecord
  input: UnknownRecord
  tool: EditTool
}

const CLAUDE_EDIT_TOOLS = new Set<EditTool>(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export function extractEditEvents(
  provider: SessionProvider,
  records: readonly SessionRecord[],
): EditEvent[]
export function extractEditEvents(
  records: readonly SessionRecord[],
  options: SessionRecordsOptions,
): EditEvent[]
export function extractEditEvents(
  first: SessionProvider | readonly SessionRecord[],
  second: readonly SessionRecord[] | SessionRecordsOptions,
): EditEvent[] {
  const { provider, records, workspaceRoot } = normalizeArguments(first, second)
  const parsed = records.map(parseRecord)
  const indices = records.map(sequenceIndexOf)
  if (provider === 'claude') return extractClaudeEvents(parsed, indices, workspaceRoot)
  if (provider === 'codex') return extractCodexEvents(parsed, indices, workspaceRoot)
  return []
}

function sequenceIndexOf(record: SessionRecord, position: number): number {
  if (typeof record !== 'string' && 'i' in record) return record.i
  return position
}

function normalizeArguments(
  first: SessionProvider | readonly SessionRecord[],
  second: readonly SessionRecord[] | SessionRecordsOptions,
): { provider: SessionProvider; records: readonly SessionRecord[]; workspaceRoot?: string } {
  if (typeof first === 'string') {
    const records = second as readonly SessionRecord[]
    return { provider: first, records }
  }

  const options = second as SessionRecordsOptions
  return {
    provider: options.provider,
    records: first,
    ...(options.workspaceRoot === undefined ? {} : { workspaceRoot: options.workspaceRoot }),
  }
}

function parseRecord(record: SessionRecord): UnknownRecord | null {
  const data = sessionRecordData(record)
  try {
    const parsed = JSON.parse(data) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractClaudeEvents(
  records: readonly (UnknownRecord | null)[],
  indices: readonly number[],
  workspaceRoot: string | undefined,
): EditEvent[] {
  const pending = new Map<string, PendingCall>()
  const events: EditEvent[] = []

  for (let position = 0; position < records.length; position += 1) {
    const record = records[position]
    const recordIndex = indices[position] as number
    if (!record) continue
    const message = objectAt(record, 'message')
    const content = message?.['content']
    if (!Array.isArray(content)) continue

    for (const rawItem of content) {
      if (!isObject(rawItem)) continue
      if (rawItem['type'] === 'tool_use') {
        const id = stringAt(rawItem, 'id')
        const name = stringAt(rawItem, 'name') as EditTool | undefined
        const input = objectAt(rawItem, 'input')
        if (id && name && input && CLAUDE_EDIT_TOOLS.has(name)) {
          pending.set(id, { recordIndex, record, input, tool: name })
        }
        continue
      }

      if (rawItem['type'] !== 'tool_result') continue
      const id = stringAt(rawItem, 'tool_use_id')
      if (!id) continue
      const call = pending.get(id)
      if (!call) continue
      pending.delete(id)
      if (rawItem['is_error'] === true) continue

      const event = claudeEvent(call, record, recordIndex, workspaceRoot)
      if (event) events.push(event)
    }
  }

  return events
}

function claudeEvent(
  call: PendingCall,
  resultRecord: UnknownRecord,
  resultRecordIndex: number,
  workspaceRoot: string | undefined,
): EditEvent | null {
  const result = objectAt(resultRecord, 'toolUseResult')
  const pathValue =
    call.tool === 'NotebookEdit'
      ? stringAt(call.input, 'notebook_path')
      : stringAt(call.input, 'file_path')
  if (!pathValue) return null

  const path = normalizePath(pathValue, workspaceRoot)
  const timestamp = stringAt(call.record, 'timestamp')
  const originalFile = stringAt(result, 'originalFile')
  let before = originalFile
  let after: string | undefined
  let replacements: TextReplacement[] = []

  if (call.tool === 'Write') {
    after = stringAt(call.input, 'content') ?? stringAt(result, 'content')
    if (before === undefined && result?.['originalFile'] === null) before = ''
  } else if (call.tool === 'Edit') {
    const replacement =
      replacementFrom(
        call.input,
        'old_string',
        'new_string',
        booleanAt(call.input, 'replace_all'),
      ) ?? replacementFrom(result, 'oldString', 'newString', booleanAt(result, 'replaceAll'))
    if (!replacement) return null
    replacements = [replacement]
    if (before === undefined) before = replacement.oldText
    after = applyReplacements(before, replacements)
  } else if (call.tool === 'MultiEdit') {
    const edits = call.input['edits']
    if (!Array.isArray(edits)) return null
    replacements = edits.flatMap((rawEdit) => {
      if (!isObject(rawEdit)) return []
      const replacement = replacementFrom(
        rawEdit,
        'old_string',
        'new_string',
        booleanAt(rawEdit, 'replace_all'),
      )
      return replacement ? [replacement] : []
    })
    if (replacements.length === 0) return null
    if (before === undefined) before = replacements[0]?.oldText ?? ''
    after = applyReplacements(before, replacements)
  } else {
    const oldSource = stringAt(call.input, 'old_source')
    const newSource = stringAt(call.input, 'new_source')
    if (oldSource !== undefined && newSource !== undefined) {
      replacements = [{ oldText: oldSource, newText: newSource }]
    }
    after =
      stringAt(result, 'content') ??
      (before !== undefined && replacements.length > 0
        ? applyReplacements(before, replacements)
        : newSource)
  }

  if (after === undefined) return null
  return {
    provider: 'claude',
    recordIndex: call.recordIndex,
    resultRecordIndex,
    tool: call.tool,
    path,
    replacements,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(before === undefined ? {} : { before }),
    after,
  }
}

function extractCodexEvents(
  records: readonly (UnknownRecord | null)[],
  indices: readonly number[],
  workspaceRoot: string | undefined,
): EditEvent[] {
  const pending = new Map<string, PendingCall>()
  const events: EditEvent[] = []

  for (let position = 0; position < records.length; position += 1) {
    const record = records[position]
    const recordIndex = indices[position] as number
    if (!record) continue
    const payload = objectAt(record, 'payload')
    if (!payload) continue

    if (stringAt(payload, 'name') === 'apply_patch') {
      const callId = stringAt(payload, 'call_id') ?? stringAt(payload, 'id')
      const input = codexPatchInput(payload)
      if (callId && input !== undefined) {
        pending.set(callId, {
          recordIndex,
          record,
          input: { patch: input },
          tool: 'apply_patch',
        })
      }
      continue
    }

    const callId = stringAt(payload, 'call_id') ?? stringAt(payload, 'id')
    if (!callId) continue
    const call = pending.get(callId)
    if (!call) continue

    if (payload['type'] === 'patch_apply_end') {
      pending.delete(callId)
      if (payload['success'] !== true) continue
      events.push(...codexEventsFromResult(call, payload, recordIndex, workspaceRoot))
      continue
    }

    if (
      payload['type'] === 'custom_tool_call_output' ||
      payload['type'] === 'function_call_output'
    ) {
      pending.delete(callId)
      if (!codexOutputSucceeded(payload)) continue
      events.push(...codexEventsFromPatch(call, recordIndex, workspaceRoot))
    }
  }

  return events
}

function codexEventsFromResult(
  call: PendingCall,
  payload: UnknownRecord,
  resultRecordIndex: number,
  workspaceRoot: string | undefined,
): EditEvent[] {
  const changes = objectAt(payload, 'changes')
  if (!changes || Object.keys(changes).length === 0) {
    return codexEventsFromPatch(call, resultRecordIndex, workspaceRoot)
  }

  const timestamp = stringAt(call.record, 'timestamp')
  return Object.entries(changes).flatMap(([rawPath, rawChange]) => {
    if (!isObject(rawChange)) return []
    const changeType = stringAt(rawChange, 'type')
    const movePath = stringAt(rawChange, 'move_path')
    const path = normalizePath(movePath ?? rawPath, workspaceRoot)
    let before: string | undefined
    let after: string | undefined
    let replacements: TextReplacement[] = []

    if (changeType === 'add') {
      before = ''
      after = stringAt(rawChange, 'content') ?? ''
    } else if (changeType === 'delete') {
      before = stringAt(rawChange, 'content') ?? ''
      after = ''
    } else if (changeType === 'update') {
      replacements = parseUnifiedReplacements(stringAt(rawChange, 'unified_diff') ?? '')
      if (replacements.length === 0) return []
    } else {
      return []
    }

    return [
      {
        provider: 'codex' as const,
        recordIndex: call.recordIndex,
        resultRecordIndex,
        tool: 'apply_patch' as const,
        path,
        replacements,
        ...(timestamp === undefined ? {} : { timestamp }),
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
      },
    ]
  })
}

function codexEventsFromPatch(
  call: PendingCall,
  resultRecordIndex: number,
  workspaceRoot: string | undefined,
): EditEvent[] {
  const patch = stringAt(call.input, 'patch') ?? ''
  const timestamp = stringAt(call.record, 'timestamp')
  return parseApplyPatch(patch).map((parsed) => ({
    provider: 'codex',
    recordIndex: call.recordIndex,
    resultRecordIndex,
    tool: 'apply_patch',
    path: normalizePath(parsed.path, workspaceRoot),
    replacements: parsed.replacements,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(parsed.before === undefined ? {} : { before: parsed.before }),
    ...(parsed.after === undefined ? {} : { after: parsed.after }),
  }))
}

// Real rollouts often carry no `success` boolean on *_call_output records —
// the outcome hides in the output payload: function_call_output wraps a JSON
// envelope with metadata.exit_code, custom_tool_call_output carries prose
// that starts with "Success." on the happy path. patch_apply_end, when
// present, remains authoritative and is handled before we get here. With no
// recognizable signal we reject: a silently-included failed patch corrupts
// the composed diff, a skipped success only leaves a gap.
function codexOutputSucceeded(payload: UnknownRecord): boolean {
  if (typeof payload['success'] === 'boolean') return payload['success']
  const output = payload['output']
  if (typeof output !== 'string') return false
  try {
    const parsed = JSON.parse(output) as unknown
    if (isObject(parsed)) {
      const exitCode = objectAt(parsed, 'metadata')?.['exit_code']
      if (typeof exitCode === 'number') return exitCode === 0
      const nested = parsed['output']
      if (typeof nested === 'string') return /^\s*success\b/i.test(nested)
    }
  } catch {
    // Not a JSON envelope: fall through to prose matching.
  }
  return /^\s*success\b/i.test(output)
}

function codexPatchInput(payload: UnknownRecord): string | undefined {
  const input = stringAt(payload, 'input')
  if (input !== undefined) return input
  const rawArguments = stringAt(payload, 'arguments')
  if (rawArguments === undefined) return undefined
  try {
    const parsed = JSON.parse(rawArguments) as unknown
    if (isObject(parsed)) return stringAt(parsed, 'patch') ?? stringAt(parsed, 'input')
  } catch {
    return rawArguments
  }
  return rawArguments
}

function parseUnifiedReplacements(diff: string): TextReplacement[] {
  const replacements: TextReplacement[] = []
  const lines = splitLinesWithEndings(diff)
  let oldText = ''
  let newText = ''
  let inHunk = false
  let coordinates: Pick<TextReplacement, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'> = {}

  const flush = (): void => {
    if (inHunk && oldText !== newText) replacements.push({ oldText, newText, ...coordinates })
    oldText = ''
    newText = ''
    coordinates = {}
  }

  for (const line of lines) {
    if (line.startsWith('@@')) {
      flush()
      inHunk = true
      coordinates = parseHunkCoordinates(line)
      continue
    }
    if (line.startsWith('\\ No newline at end of file')) continue
    // apply_patch Update bodies may omit the @@ marker entirely (small
    // files); `--- `/`+++ ` file headers must not open that implicit hunk.
    if (!inHunk) {
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('*** ')) continue
      if (line.startsWith('-') || line.startsWith('+') || line.startsWith(' ')) inHunk = true
      else continue
    }
    if (line.startsWith('-')) oldText += line.slice(1)
    else if (line.startsWith('+')) newText += line.slice(1)
    else if (line.startsWith(' ')) {
      oldText += line.slice(1)
      newText += line.slice(1)
    } else if (line === '\n' || line === '\r\n') {
      // Some producers emit blank context lines without the leading space.
      oldText += line
      newText += line
    }
  }
  flush()
  return replacements
}

function parseHunkCoordinates(
  header: string,
): Pick<TextReplacement, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'> {
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  if (!match) return {}
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newLines: match[4] === undefined ? 1 : Number(match[4]),
  }
}

function parseApplyPatch(patch: string): Array<{
  path: string
  replacements: TextReplacement[]
  before?: string
  after?: string
}> {
  const result: Array<{
    path: string
    replacements: TextReplacement[]
    before?: string
    after?: string
  }> = []
  const sectionPattern = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm
  const matches = [...patch.matchAll(sectionPattern)]

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const kind = match?.[1]
    const path = match?.[2]?.trim()
    if (!kind || !path || match.index === undefined) continue
    const bodyStart = match.index + match[0].length
    const bodyEnd = matches[index + 1]?.index ?? patch.indexOf('*** End Patch', bodyStart)
    const body = patch.slice(bodyStart, bodyEnd < 0 ? patch.length : bodyEnd).replace(/^\r?\n/, '')

    if (kind === 'Add') {
      const after = splitLinesWithEndings(body)
        .filter((line) => line.startsWith('+'))
        .map((line) => line.slice(1))
        .join('')
      result.push({ path, before: '', after, replacements: [] })
    } else if (kind === 'Delete') {
      result.push({ path, replacements: [] })
    } else {
      result.push({ path, replacements: parseUnifiedReplacements(body) })
    }
  }

  return result
}

function replacementFrom(
  source: UnknownRecord | null | undefined,
  oldKey: string,
  newKey: string,
  replaceAll: boolean | undefined,
): TextReplacement | null {
  const oldText = stringAt(source, oldKey)
  const newText = stringAt(source, newKey)
  if (oldText === undefined || newText === undefined) return null
  return { oldText, newText, ...(replaceAll === undefined ? {} : { replaceAll }) }
}

function applyReplacements(initial: string, replacements: readonly TextReplacement[]): string {
  let result = initial
  for (const replacement of replacements) {
    if (replacement.oldText === '') continue
    result = replacement.replaceAll
      ? result.split(replacement.oldText).join(replacement.newText)
      : replaceOnce(result, replacement.oldText, replacement.newText)
  }
  return result
}

function replaceOnce(value: string, search: string, replacement: string): string {
  const index = value.indexOf(search)
  if (index < 0) return value
  return value.slice(0, index) + replacement + value.slice(index + search.length)
}

function normalizePath(path: string, workspaceRoot: string | undefined): string {
  let normalized = path.replaceAll('\\', '/')
  const normalizedRoot = workspaceRoot?.replaceAll('\\', '/').replace(/\/$/, '')
  if (normalized === '$SPOOL_WS') return '.'
  if (normalized.startsWith('$SPOOL_WS/')) normalized = normalized.slice('$SPOOL_WS/'.length)
  else if (normalizedRoot && normalized === normalizedRoot) normalized = '.'
  else if (normalizedRoot && normalized.startsWith(`${normalizedRoot}/`)) {
    normalized = normalized.slice(normalizedRoot.length + 1)
  }
  normalized = normalized.replace(/^\.\//, '')
  return normalized || '.'
}

function splitLinesWithEndings(value: string): string[] {
  if (value.length === 0) return []
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\n') {
      lines.push(value.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < value.length) lines.push(value.slice(start))
  return lines
}

function objectAt(source: UnknownRecord | null | undefined, key: string): UnknownRecord | null {
  const value = source?.[key]
  return isObject(value) ? value : null
}

function stringAt(source: UnknownRecord | null | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' ? value : undefined
}

function booleanAt(source: UnknownRecord | null | undefined, key: string): boolean | undefined {
  const value = source?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
