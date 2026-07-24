import { describe, expect, it } from 'vite-plus/test'

import type { AutoPublishResult } from '../hub/auto-publish.js'
import { createTextUi } from '../ui.js'
import { createAutoPublisher, syncLocalSessions } from './sync.js'

describe('syncLocalSessions', () => {
  it('reports database initialization failures through the CLI UI', () => {
    const output: string[] = []
    const errors: string[] = []
    const ui = createTextUi(
      (message) => output.push(message),
      (message) => errors.push(message),
    )

    expect(
      syncLocalSessions(ui, {
        createSyncer: () => {
          throw new Error('database is not writable')
        },
      }),
    ).toBeNull()

    expect(output).toContain('Scanning local Agent sessions')
    expect(errors).toEqual(['Session sync failed', 'database is not writable'])
  })
})

describe('createAutoPublisher', () => {
  const emptyResult: AutoPublishResult = {
    matched: 0,
    published: [],
    unchanged: 0,
    skippedSecrets: 0,
    failed: 0,
  }

  it('coalesces overlapping triggers into one trailing pass', async () => {
    const ui = createTextUi(
      () => {},
      () => {},
    )
    let resolveFirst: (() => void) | undefined
    let runs = 0
    const autoPublish = createAutoPublisher(ui, {
      run: () => {
        runs += 1
        if (runs === 1) {
          return new Promise((resolve) => {
            resolveFirst = () => resolve(emptyResult)
          })
        }
        return Promise.resolve(emptyResult)
      },
    })

    const first = autoPublish()
    // Both re-triggers land while the first pass is in flight.
    void autoPublish()
    void autoPublish()
    resolveFirst?.()
    await first

    expect(runs).toBe(2)
  })

  it('reports published sessions and swallows pass failures', async () => {
    const output: string[] = []
    const ui = createTextUi(
      (message) => output.push(message),
      (message) => output.push(message),
    )
    const autoPublish = createAutoPublisher(ui, {
      run: async () => ({
        ...emptyResult,
        matched: 1,
        published: [{ sid: 'claude_abc', url: 'https://hub.test/s/claude_abc' }],
      }),
    })
    await autoPublish()
    expect(output.join('\n')).toContain('Auto-published claude_abc → https://hub.test/s/claude_abc')

    const failing = createAutoPublisher(ui, {
      run: async () => {
        throw new Error('index locked')
      },
    })
    await expect(failing()).resolves.toBeUndefined()
    expect(output.join('\n')).toContain('Auto-publish failed: index locked')
  })
})
