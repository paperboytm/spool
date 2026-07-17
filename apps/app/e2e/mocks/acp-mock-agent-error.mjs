#!/usr/bin/env node
// Mock ACP agent — returns error on prompt.
import { send, runMockAgent } from './acp-base.mjs'

runMockAgent((id) => {
  send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal agent error: model unavailable' } })
})
