import { describe, expect, it } from 'vite-plus/test'

import { createTextUi } from '../ui.js'
import { syncLocalSessions } from './sync.js'

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
