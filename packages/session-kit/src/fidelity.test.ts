import { describe, expect, it } from 'vitest'

import { composeSessionDiff } from './diff.js'
import { extractEditEvents } from './edits.js'
import { deriveView } from './view.js'

// Fidelity tests against provider shapes that the synthetic happy-path
// fixtures don't cover: outputs without a `success` boolean, apply_patch
// bodies without @@ markers, and sparse (indexed) record fetches.

const claudeCall = (id: string, input: Record<string, unknown>): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-16T10:00:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Edit', input }],
    },
  })

const claudeResult = (id: string, toolUseResult: Record<string, unknown>): string =>
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }],
    },
    toolUseResult,
  })

const codexPatchCall = (callId: string, patch: string): string =>
  JSON.stringify({
    timestamp: '2026-07-16T10:00:00.000Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'apply_patch',
      call_id: callId,
      arguments: JSON.stringify({ input: patch }),
    },
  })

const codexOutput = (callId: string, output: unknown): string =>
  JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'function_call_output',
      call_id: callId,
      output: typeof output === 'string' ? output : JSON.stringify(output),
    },
  })

describe('codex output success detection', () => {
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-foo\n+bar\n*** End Patch'

  it('accepts function_call_output without a success field when exit_code is 0', () => {
    const events = extractEditEvents('codex', [
      codexPatchCall('c1', patch),
      codexOutput('c1', { output: 'Success.', metadata: { exit_code: 0 } }),
    ])
    expect(events).toHaveLength(1)
    expect(events[0]?.path).toBe('src/a.ts')
  })

  it('rejects function_call_output whose metadata exit_code is nonzero', () => {
    const events = extractEditEvents('codex', [
      codexPatchCall('c1', patch),
      codexOutput('c1', { output: 'patch failed', metadata: { exit_code: 1 } }),
    ])
    expect(events).toHaveLength(0)
  })

  it('accepts Success-prose outputs from the custom apply_patch tool', () => {
    const events = extractEditEvents('codex', [
      codexPatchCall('c1', patch),
      codexOutput('c1', 'Success. Updated the following files:\nM src/a.ts'),
    ])
    expect(events).toHaveLength(1)
  })

  it('rejects outputs with no recognizable success signal', () => {
    const events = extractEditEvents('codex', [
      codexPatchCall('c1', patch),
      codexOutput('c1', 'Done applying patch'),
    ])
    expect(events).toHaveLength(0)
  })
})

describe('apply_patch bodies without @@ markers', () => {
  it('extracts replacements from a headerless Update section', () => {
    const patch = '*** Begin Patch\n*** Update File: src/b.ts\n-old line\n+new line\n*** End Patch'
    const events = extractEditEvents('codex', [
      codexPatchCall('c2', patch),
      codexOutput('c2', { output: 'Success.', metadata: { exit_code: 0 } }),
    ])
    expect(events).toHaveLength(1)
    expect(events[0]?.replacements).toEqual([
      { oldText: 'old line\n', newText: 'new line\n' },
    ])
  })
})

describe('sparse indexed records', () => {
  const call = claudeCall('toolu_9', {
    file_path: '/ws/src/c.ts',
    old_string: 'alpha',
    new_string: 'beta',
  })
  const result = claudeResult('toolu_9', {
    originalFile: 'alpha\ngamma\n',
    oldString: 'alpha',
    newString: 'beta',
  })

  it('attributes events to the sequence index, not the array position', () => {
    const events = extractEditEvents([{ i: 7, data: call }, { i: 8, data: result }], {
      provider: 'claude',
      workspaceRoot: '/ws',
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.recordIndex).toBe(7)
    expect(events[0]?.resultRecordIndex).toBe(8)
    expect(events[0]?.path).toBe('src/c.ts')
  })

  it('flows sequence indices into the per-file fetch list', () => {
    const events = extractEditEvents([{ i: 7, data: call }, { i: 8, data: result }], {
      provider: 'claude',
      workspaceRoot: '/ws',
    })
    const diff = composeSessionDiff(events)
    expect(diff.files[0]?.events).toEqual([7, 8])
    expect(diff.files[0]?.newText).toBe('beta\ngamma\n')
  })
})

describe('view fetch-list contract', () => {
  it('files[].events includes both call and paired result indices', () => {
    const user = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'please rename alpha' },
    })
    const call = claudeCall('toolu_1', {
      file_path: '/ws/src/d.ts',
      old_string: 'alpha',
      new_string: 'beta',
    })
    const result = claudeResult('toolu_1', {
      originalFile: 'alpha\n',
      oldString: 'alpha',
      newString: 'beta',
    })
    const view = deriveView([user, call, result], { provider: 'claude', workspaceRoot: '/ws' })
    expect(view.files[0]?.events).toEqual([1, 2])
  })
})
