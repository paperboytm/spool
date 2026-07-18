import { PassThrough, Readable } from 'node:stream'

import { describe, expect, it } from 'vite-plus/test'

import { createClackUi } from './ui.js'

describe('createClackUi', () => {
  it('falls back to stable text without terminal control codes when no TTY is available', () => {
    const output = new PassThrough()
    const errorOutput = new PassThrough()
    let stdout = ''
    let stderr = ''
    output.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    errorOutput.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const ui = createClackUi({
      input: Readable.from([]),
      output,
      errorOutput,
      interactive: false,
    })

    ui.intro('Share a session')
    const status = ui.spinner()
    status.start('Uploading session')
    status.stop('Session uploaded')
    ui.error('Example failure')

    expect(stdout).toBe('Share a session\nUploading session\nSession uploaded\n')
    expect(stderr).toBe('Example failure\n')
    expect(stdout + stderr).not.toContain('\u001B')
  })
})
