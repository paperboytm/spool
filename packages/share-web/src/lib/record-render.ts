// Turn a raw canonical record into displayable segments for the expanded
// timeline row. Provider-aware but deliberately forgiving: anything not
// recognized degrades to pretty-printed JSON rather than disappearing.

export interface RecordSegment {
  kind: 'text' | 'tool-call' | 'tool-result' | 'raw'
  label?: string
  text: string
}

export function renderRecordSegments(
  provider: 'claude' | 'codex',
  data: string,
): RecordSegment[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return [{ kind: 'raw', text: data }]
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [{ kind: 'raw', text: data }]
  }
  const record = parsed as Record<string, unknown>
  const segments = provider === 'claude' ? claudeSegments(record) : codexSegments(record)
  if (segments.length > 0) return segments
  return [{ kind: 'raw', text: prettyJson(record) }]
}

function claudeSegments(record: Record<string, unknown>): RecordSegment[] {
  const message = objectAt(record, 'message')
  const content = message?.['content']
  if (typeof content === 'string') {
    return content.trim() === '' ? [] : [{ kind: 'text', text: content }]
  }
  if (!Array.isArray(content)) return []
  const segments: RecordSegment[] = []
  for (const item of content) {
    if (typeof item !== 'object' || item === null) continue
    const block = item as Record<string, unknown>
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      segments.push({ kind: 'text', text: block['text'] })
    } else if (block['type'] === 'tool_use') {
      const name = typeof block['name'] === 'string' ? block['name'] : 'tool'
      segments.push({
        kind: 'tool-call',
        label: name,
        text: prettyJson(block['input'] ?? {}),
      })
    } else if (block['type'] === 'tool_result') {
      segments.push({
        kind: 'tool-result',
        label: 'result',
        text: flattenToolResult(block['content']),
      })
    }
  }
  return segments
}

function codexSegments(record: Record<string, unknown>): RecordSegment[] {
  const payload = objectAt(record, 'payload')
  if (!payload) return []
  const type = payload['type']
  if ((type === 'user_message' || type === 'agent_message') && typeof payload['message'] === 'string') {
    return [{ kind: 'text', text: payload['message'] }]
  }
  if (type === 'function_call' || type === 'custom_tool_call') {
    const name = typeof payload['name'] === 'string' ? payload['name'] : 'tool'
    const input = payload['input'] ?? payload['arguments'] ?? {}
    return [{
      kind: 'tool-call',
      label: name,
      text: typeof input === 'string' ? input : prettyJson(input),
    }]
  }
  if (type === 'function_call_output' || type === 'custom_tool_call_output') {
    const output = payload['output']
    return [{
      kind: 'tool-result',
      label: 'result',
      text: typeof output === 'string' ? output : prettyJson(output ?? {}),
    }]
  }
  const content = payload['content']
  if (Array.isArray(content)) {
    const texts = content
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) => typeof item['text'] === 'string')
      .map((item) => item['text'] as string)
    if (texts.length > 0) return [{ kind: 'text', text: texts.join('\n') }]
  }
  return []
}

function flattenToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>)['text'] === 'string') {
          return (item as Record<string, unknown>)['text'] as string
        }
        return prettyJson(item)
      })
      .join('\n')
  }
  return prettyJson(content ?? '')
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function objectAt(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
