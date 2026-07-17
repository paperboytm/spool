#!/usr/bin/env node
// Mock ACP agent — streams text chunks + tool call on prompt.
import { reply, notify, runMockAgent } from './acp-base.mjs'

const CHUNKS = [
  'Based on your knowledge base, ',
  'I found that MOCK_ACP_RESPONSE_42 appears in your recent sessions. ',
  'This relates to the search indexing feature you were working on.',
]

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

runMockAgent(async (id, params) => {
  const sessionId = params.sessionId ?? 'mock-session-001'

  notify('session/update', {
    sessionId,
    update: { sessionUpdate: 'tool_call', toolCallId: 'mock-tool-001', title: 'Searching knowledge base', kind: 'search', status: 'in_progress' },
  })

  await sleep(50)

  notify('session/update', {
    sessionId,
    update: { sessionUpdate: 'tool_call_update', toolCallId: 'mock-tool-001', title: 'Searching knowledge base', status: 'completed' },
  })

  for (const text of CHUNKS) {
    await sleep(30)
    notify('session/update', {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    })
  }

  reply(id, { stopReason: 'end_turn' })
})
