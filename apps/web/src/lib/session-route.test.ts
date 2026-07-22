import type { SpoolDocument } from '@spool/share-kit'
import { describe, expect, it } from 'vite-plus/test'

import type { HubRecordLine } from './hub-api'
import { deriveSessionRoute, projectSessionRouteToSpool } from './session-route'

let seq = 0
function rec(data: object): HubRecordLine {
  return { i: seq++, oid: `oid-${seq}`, data: JSON.stringify(data) }
}

function claudePrompt(text: string, timestamp?: string): HubRecordLine {
  return rec({
    type: 'user',
    ...(timestamp === undefined ? {} : { timestamp }),
    message: { role: 'user', content: text },
  })
}

function claudeToolUse(name: string, input: object = {}, id = `tool-${seq}`): HubRecordLine {
  return rec({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name, id, input }] },
  })
}

function claudeToolResult(
  toolUseId: string,
  options: { isError?: boolean; content?: string } = {},
): HubRecordLine {
  return rec({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          is_error: options.isError ?? false,
          content: options.content ?? 'ok',
        },
      ],
    },
  })
}

function codexEventPrompt(text: string, timestamp: string): HubRecordLine {
  return rec({ timestamp, type: 'event_msg', payload: { type: 'user_message', message: text } })
}

function codexResponsePrompt(text: string, timestamp: string): HubRecordLine {
  return rec({
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    },
  })
}

function codexCall(
  name: string,
  args: object | string,
  id: string,
  type: 'function_call' | 'custom_tool_call' = 'function_call',
): HubRecordLine {
  return rec({
    type: 'response_item',
    payload: {
      type,
      name,
      call_id: id,
      ...(type === 'function_call'
        ? { arguments: typeof args === 'string' ? args : JSON.stringify(args) }
        : { input: typeof args === 'string' ? args : JSON.stringify(args) }),
    },
  })
}

function codexOutput(id: string, output: unknown): HubRecordLine {
  return rec({
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: id, output: JSON.stringify(output) },
  })
}

function spoolDocument(
  turns: SpoolDocument['conversation']['turns'],
  selected?: number[],
): SpoolDocument {
  return {
    version: 2,
    exportedAt: '2026-07-22T00:00:00.000Z',
    conversation: {
      source: 'claude-code',
      sourceLabel: 'Claude Code',
      origin: { kind: 'agent-session', agent: 'claude' },
      title: 'Curated session',
      shareUrl: null,
      createdAt: '2026-07-22T00:00:00.000Z',
      wordCount: 10,
      readMin: 1,
      turns,
    },
    opts: {
      template: 'chat',
      paper: 'snow',
      typeface: 'geist',
      colorway: 'amber',
      accentHex: '#C85A00',
      density: 'compact',
      redact: false,
      showGaps: true,
      showMasthead: false,
      showColophon: false,
      hideEmptyTurns: true,
      ...(selected === undefined ? {} : { selected }),
    },
  }
}

describe('deriveSessionRoute — Claude Code', () => {
  it('returns null for sessions with no authored or tool activity', () => {
    seq = 0
    expect(deriveSessionRoute([rec({ type: 'mode' })])).toBeNull()
  })

  it('segments authored prompts and keeps check failures out of generic errors', () => {
    seq = 0
    const route = deriveSessionRoute([
      claudePrompt('Fix the refresh race between tabs', '2026-07-22T00:00:00Z'),
      claudeToolUse('Read'),
      claudeToolUse('Edit'),
      claudePrompt('Now make the tests pass', '2026-07-22T00:01:00Z'),
      claudeToolUse('Bash', { command: 'pnpm --filter @spool/web test' }, 'check-1'),
      claudeToolResult('check-1', { isError: true, content: 'Exit code 1' }),
      claudeToolUse('Bash', { command: 'pnpm test' }, 'check-2'),
      claudeToolResult('check-2'),
      claudeToolUse('WebFetch', {}, 'fetch-1'),
      claudeToolResult('fetch-1', { isError: true, content: 'network denied' }),
    ])

    expect(route).not.toBeNull()
    expect(route!.goal).toBe('Fix the refresh race between tabs')
    expect(route!.phases).toHaveLength(2)
    expect(route!.phases[0]).toMatchObject({
      timestamp: '2026-07-22T00:00:00Z',
      isPrompt: true,
      tools: 2,
      edits: 1,
    })
    expect(route!.phases[1]).toMatchObject({
      checkRuns: 2,
      checkFails: 1,
      errors: 1,
    })
    expect(route!.totalErrors).toBe(2)
  })

  it('recognizes a failed piped check from its test summary when the tool flag is false', () => {
    seq = 0
    const route = deriveSessionRoute([
      claudePrompt('Run the suite'),
      claudeToolUse('Bash', { command: 'pnpm test 2>&1 | tail -8' }, 'check-1'),
      claudeToolResult('check-1', {
        isError: false,
        content: ' Test Files  1 failed | 26 passed (27)\n[ELIFECYCLE] Test failed.',
      }),
    ])

    expect(route!.phases[0]).toMatchObject({ checkRuns: 1, checkFails: 1, errors: 0 })
    expect(route!.totalErrors).toBe(1)
  })

  it('skips tool results, sidechains, and tag-like payloads when finding prompts', () => {
    seq = 0
    const route = deriveSessionRoute([
      rec({ type: 'user', message: { role: 'user', content: '<task-notification>x' } }),
      rec({ type: 'user', isSidechain: true, message: { role: 'user', content: 'sidechain' } }),
      claudePrompt('The real goal'),
      claudeToolUse('Bash', { command: 'ls' }),
    ])
    expect(route!.phases).toHaveLength(1)
    expect(route!.goal).toBe('The real goal')
    expect(route!.phases[0]).toMatchObject({ commands: 1, checkRuns: 0 })
  })

  it('keeps legitimate markup prompts and repeated prompts as distinct steering phases', () => {
    seq = 0
    const route = deriveSessionRoute([
      claudePrompt('<main>Fix this JSX layout</main>'),
      claudePrompt('继续'),
      claudeToolUse('Read'),
      claudePrompt('继续'),
      claudeToolUse('Edit'),
    ])

    expect(route!.phases.map((phase) => phase.label)).toEqual([
      '<main>Fix this JSX layout</main>',
      '继续',
      '继续',
    ])
    expect(route!.phases[1]).toMatchObject({ tools: 1, edits: 0 })
    expect(route!.phases[2]).toMatchObject({ tools: 1, edits: 1 })
  })

  it('captures a recorded PR as the outcome', () => {
    seq = 0
    const route = deriveSessionRoute([
      claudePrompt('Ship it'),
      rec({
        type: 'pr-link',
        prUrl: 'https://github.com/paperboytm/spool/pull/9',
        prNumber: 9,
        prRepository: 'paperboytm/spool',
      }),
    ])
    expect(route!.prUrl).toBe('https://github.com/paperboytm/spool/pull/9')
    expect(route!.prLabel).toBe('PR #9 · paperboytm/spool')
  })

  it('captures the validated URL emitted by a normal gh pr create command', () => {
    seq = 0
    const route = deriveSessionRoute([
      claudePrompt('Open the pull request'),
      claudeToolUse('Bash', { command: 'gh pr create --fill' }, 'pr-create'),
      claudeToolResult('pr-create', {
        content: 'https://github.com/paperboytm/spool/pull/11\n',
      }),
    ])

    expect(route!.prUrl).toBe('https://github.com/paperboytm/spool/pull/11')
    expect(route!.prLabel).toBe('PR #11 · paperboytm/spool')
  })

  it('ignores unsafe or non-GitHub PR links and derives labels from the URL', () => {
    seq = 0
    const route = deriveSessionRoute([
      claudePrompt('Ship it'),
      rec({
        type: 'pr-link',
        prUrl: 'javascript:alert(1)',
        prNumber: 1,
        prRepository: 'spoofed/repository',
      }),
      rec({
        type: 'pr-link',
        prUrl: 'https://github.com/paperboytm/spool/pull/10',
        prNumber: 999,
        prRepository: 'spoofed/repository',
      }),
    ])

    expect(route!.prUrl).toBe('https://github.com/paperboytm/spool/pull/10')
    expect(route!.prLabel).toBe('PR #10 · paperboytm/spool')
  })

  it('collects pre-prompt activity into an implicit opening phase', () => {
    seq = 0
    const route = deriveSessionRoute([claudeToolUse('Read'), claudeToolUse('Read')])
    expect(route!.phases).toHaveLength(1)
    expect(route!.phases[0]).toMatchObject({ label: 'Session start', isPrompt: false })
    expect(route!.goal).toBeNull()
  })
})

describe('deriveSessionRoute — Codex', () => {
  it('uses event messages as authored prompts and parses Codex calls and outputs', () => {
    seq = 0
    const firstTimestamp = '2026-07-22T01:00:00Z'
    const secondTimestamp = '2026-07-22T01:01:00Z'
    const route = deriveSessionRoute([
      codexResponsePrompt('# AGENTS.md instructions for /workspace\ninternal', firstTimestamp),
      codexResponsePrompt('Implement the route map', firstTimestamp),
      codexEventPrompt('Implement the route map', firstTimestamp),
      codexCall('apply_patch', '*** Begin Patch', 'edit-1', 'custom_tool_call'),
      codexOutput('edit-1', { output: 'Success.', metadata: { exit_code: 0 } }),
      codexResponsePrompt('Make the tests pass', secondTimestamp),
      codexEventPrompt('Make the tests pass', secondTimestamp),
      codexCall('exec_command', { cmd: 'pnpm --filter @spool/web test' }, 'check-1'),
      codexOutput('check-1', { output: 'failed', metadata: { exit_code: 1 } }),
      // Some Codex versions emit a second result shape for the same call.
      rec({
        type: 'event_msg',
        payload: { type: 'patch_apply_end', call_id: 'check-1', success: false },
      }),
      codexCall('web_search', { query: 'docs' }, 'web-1'),
      rec({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'web-1',
          is_error: true,
          output: 'network denied',
        },
      }),
    ])

    expect(route!.goal).toBe('Implement the route map')
    expect(route!.phases).toHaveLength(2)
    expect(route!.phases[0]).toMatchObject({ edits: 1, tools: 1 })
    expect(route!.phases[1]).toMatchObject({
      commands: 1,
      checkRuns: 1,
      checkFails: 1,
      errors: 1,
      tools: 2,
    })
    expect(route!.totalErrors).toBe(2)
  })

  it('falls back to response-item user messages for older response-only rollouts', () => {
    seq = 0
    const route = deriveSessionRoute([
      codexResponsePrompt(
        '# AGENTS.md instructions for /workspace\ninternal',
        '2026-01-01T00:00:00Z',
      ),
      codexResponsePrompt('Actual old-format prompt', '2026-01-01T00:00:01Z'),
      codexCall('exec', 'pnpm typecheck', 'check-1', 'custom_tool_call'),
      codexOutput('check-1', { output: 'ok', metadata: { exit_code: 0 } }),
    ])

    expect(route!.goal).toBe('Actual old-format prompt')
    expect(route!.phases).toHaveLength(1)
    expect(route!.phases[0]).toMatchObject({ commands: 1, checkRuns: 1, checkFails: 0 })
  })
})

describe('projectSessionRouteToSpool', () => {
  it('uses only visible curated labels and supplies exact timeline turn anchors', () => {
    seq = 0
    const rawRoute = deriveSessionRoute([
      claudePrompt('Secret first phase', '2026-07-22T02:00:00Z'),
      claudeToolUse('Bash', { command: 'pnpm test' }, 'hidden-check'),
      claudeToolResult('hidden-check', { isError: true }),
      claudePrompt('Raw second phase', '2026-07-22T02:01:00Z'),
      claudeToolUse('Edit'),
      claudePrompt('Raw third phase', '2026-07-22T02:02:00Z'),
      claudeToolUse('Read'),
    ])
    const document = spoolDocument(
      [
        { role: 'user', body: 'Secret first phase', timestamp: '2026-07-22T02:00:00Z' },
        { role: 'assistant', body: 'Hidden answer', timestamp: '2026-07-22T02:00:30Z' },
        { role: 'user', body: 'Published second phase', timestamp: '2026-07-22T02:01:00Z' },
        { role: 'assistant', body: 'Visible answer', timestamp: '2026-07-22T02:01:30Z' },
        { role: 'user', body: 'Published third phase', timestamp: '2026-07-22T02:02:00Z' },
        { role: 'assistant', body: 'Done', timestamp: '2026-07-22T02:02:30Z' },
      ],
      [2, 3, 4, 5],
    )

    const projected = projectSessionRouteToSpool(rawRoute, document)

    expect(projected!.goal).toBe('Published second phase')
    expect(projected!.phases.map(({ label, turnIndex }) => [label, turnIndex])).toEqual([
      ['Published second phase', 2],
      ['Published third phase', 4],
    ])
    expect(projected!.phases.map((phase) => phase.label)).not.toContain('Secret first phase')
    expect(projected!.totalErrors).toBe(0)
    expect(projected!.prUrl).toBeNull()
  })

  it('falls back to prompt order when legacy .spool turns have no timestamps', () => {
    seq = 0
    const rawRoute = deriveSessionRoute([
      claudePrompt('Raw first'),
      claudePrompt('Raw second'),
      claudePrompt('Raw third'),
    ])
    const document = spoolDocument(
      [
        { role: 'user', body: 'Hidden first' },
        { role: 'user', body: 'Visible second' },
        { role: 'user', body: 'Visible third' },
      ],
      [1, 2],
    )

    const projected = projectSessionRouteToSpool(rawRoute, document)
    expect(projected!.phases.map(({ label, turnIndex }) => [label, turnIndex])).toEqual([
      ['Visible second', 1],
      ['Visible third', 2],
    ])
  })

  it('renders a stable curated route before raw evidence arrives', () => {
    const projected = projectSessionRouteToSpool(
      null,
      spoolDocument(
        [
          { role: 'user', body: 'Hidden first' },
          { role: 'assistant', body: 'Hidden answer' },
          { role: 'user', body: 'Visible second' },
          { role: 'assistant', body: 'Visible answer' },
          { role: 'user', body: 'Visible third' },
        ],
        [2, 3, 4],
      ),
    )

    expect(projected).toMatchObject({
      goal: 'Visible second',
      totalErrors: 0,
      prUrl: null,
      prLabel: null,
    })
    expect(projected!.phases.map(({ label, turnIndex }) => [label, turnIndex])).toEqual([
      ['Visible second', 2],
      ['Visible third', 4],
    ])
  })
})
