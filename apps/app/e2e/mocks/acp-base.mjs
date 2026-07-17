import { createInterface } from 'node:readline'

export function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

export function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

export function notify(method, params) {
  send({ jsonrpc: '2.0', method, params })
}

const BASE_HANDLERS = {
  initialize(id) {
    reply(id, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { imageSupport: false, audioSupport: false },
      },
      authMethods: [],
    })
  },

  'session/new'(id) {
    reply(id, { sessionId: 'mock-session-001', availableModes: ['code'] })
  },
}

export function runMockAgent(promptHandler) {
  const handlers = { ...BASE_HANDLERS, 'session/prompt': promptHandler }

  let pending = 0
  let stdinClosed = false
  function maybeExit() { if (stdinClosed && pending === 0) process.exit(0) }

  const rl = createInterface({ input: process.stdin })

  rl.on('line', (line) => {
    let msg
    try { msg = JSON.parse(line) } catch { return }

    const handler = handlers[msg.method]
    if (handler) {
      const result = handler(msg.id, msg.params ?? {})
      if (result && typeof result.then === 'function') {
        pending++
        result.finally(() => { pending--; maybeExit() })
      }
    } else if (msg.id !== undefined) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } })
    }
  })

  rl.on('close', () => { stdinClosed = true; maybeExit() })
}
