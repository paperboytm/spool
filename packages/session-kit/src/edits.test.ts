import { describe, expect, it } from 'vitest'
import { extractEditEvents } from './edits.js'

const line = (value: unknown): string => JSON.stringify(value)

describe('extractEditEvents', () => {
  it('pairs Claude edit calls with successful results and excludes failures', () => {
    const records = [
      line({
        type: 'assistant', timestamp: '2026-01-01T00:00:00Z',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'edit-ok', name: 'Edit', input: { file_path: '$SPOOL_WS/src/a.ts', old_string: 'alpha', new_string: 'beta' } }] },
      }),
      line({
        type: 'user', timestamp: '2026-01-01T00:00:01Z', toolUseResult: { originalFile: 'alpha\nkeep\n' },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'edit-ok', is_error: false, content: 'updated' }] },
      }),
      line({
        type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'write-failed', name: 'Write', input: { file_path: '$SPOOL_WS/src/failed.ts', content: 'nope' } }] },
      }),
      line({
        type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'write-failed', is_error: true, content: 'denied' }] },
      }),
      line({
        type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'write-ok', name: 'Write', input: { file_path: '$SPOOL_WS/src/new.ts', content: 'new file\n' } }] },
      }),
      line({
        type: 'user', toolUseResult: { originalFile: null },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'write-ok', content: 'created' }] },
      }),
      line({
        type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'multi-ok', name: 'MultiEdit', input: { file_path: '$SPOOL_WS/src/a.ts', edits: [{ old_string: 'beta', new_string: 'gamma' }, { old_string: 'keep', new_string: 'stay' }] } }] },
      }),
      line({
        type: 'user', toolUseResult: { originalFile: 'beta\nkeep\n' },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'multi-ok', content: 'updated' }] },
      }),
      line({
        type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'notebook-ok', name: 'NotebookEdit', input: { notebook_path: '$SPOOL_WS/lab.ipynb', cell_id: 'cell-1', new_source: 'print(2)' } }] },
      }),
      line({
        type: 'user', toolUseResult: { originalFile: '{"cell":"print(1)"}', content: '{"cell":"print(2)"}' },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'notebook-ok', content: 'updated' }] },
      }),
    ]

    const events = extractEditEvents('claude', records)

    expect(events).toHaveLength(4)
    expect(events.map(event => [event.tool, event.path, event.recordIndex, event.resultRecordIndex])).toEqual([
      ['Edit', 'src/a.ts', 0, 1],
      ['Write', 'src/new.ts', 4, 5],
      ['MultiEdit', 'src/a.ts', 6, 7],
      ['NotebookEdit', 'lab.ipynb', 8, 9],
    ])
    expect(events[0]).toMatchObject({ before: 'alpha\nkeep\n', after: 'beta\nkeep\n' })
    expect(events[2]).toMatchObject({ before: 'beta\nkeep\n', after: 'gamma\nstay\n' })
    expect(events[3]).toMatchObject({ before: '{"cell":"print(1)"}', after: '{"cell":"print(2)"}' })
  })

  it('uses only confirmed successful Codex apply_patch calls', () => {
    const records = [
      line({ timestamp: '2026-01-01T00:00:00Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call-ok', status: 'completed', input: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-alpha\n+beta\n keep\n*** End Patch' } }),
      line({ timestamp: '2026-01-01T00:00:01Z', type: 'event_msg', payload: { type: 'patch_apply_end', call_id: 'call-ok', status: 'completed', success: true, changes: { '$SPOOL_WS/src/a.ts': { type: 'update', move_path: null, unified_diff: '@@ -1,2 +1,2 @@\n-alpha\n+beta\n keep\n' } } } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-ok', output: 'Done!' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call-failed', status: 'completed', input: '*** Begin Patch\n*** Add File: src/no.ts\n+no\n*** End Patch' } }),
      line({ type: 'event_msg', payload: { type: 'patch_apply_end', call_id: 'call-failed', status: 'completed', success: false, changes: {} } }),
    ]

    const events = extractEditEvents(records, { provider: 'codex' })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      provider: 'codex', tool: 'apply_patch', path: 'src/a.ts', recordIndex: 0, resultRecordIndex: 1,
      replacements: [{ oldText: 'alpha\nkeep\n', newText: 'beta\nkeep\n', oldStart: 1, oldLines: 2, newStart: 1, newLines: 2 }],
    })
  })

  it('does not infer Codex success from result prose', () => {
    const records = [
      line({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call-1', input: '*** Begin Patch\n*** Add File: src/a.ts\n+content\n*** End Patch' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-1', output: 'Invalid Context' } }),
    ]

    expect(extractEditEvents('codex', records)).toEqual([])
  })
})
