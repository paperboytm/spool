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

  it('loads the next autocomplete page when the user reaches the end', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const ui = createClackUi({ input, output, interactive: true })
    let loadCalls = 0

    const selected = ui.autocomplete({
      message: 'Select a Session',
      choices: [1, 2, 3, 4, 5].map((n) => ({ value: `s${n}`, label: `Session ${n}` })),
      loadMore: () => {
        loadCalls += 1
        return {
          choices: [6, 7, 8, 9, 10].map((n) => ({
            value: `s${n}`,
            label: `Session ${n}`,
          })),
          hasMore: false,
        }
      },
      maxItems: 5,
    })

    input.write('\u001B[B'.repeat(5))
    input.write('\r')

    await expect(selected).resolves.toBe('s6')
    expect(loadCalls).toBe(1)
  })

  it('selects the visible match when the user searches and immediately presses Enter', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const ui = createClackUi({ input, output, interactive: true })
    const searches: Array<string | undefined> = []

    const selected = ui.autocomplete({
      message: 'Select a Session',
      choices: [1, 2, 3, 4, 5].map((n) => ({ value: `recent-${n}`, label: `Recent ${n}` })),
      loadMore: (search?: string) => {
        searches.push(search)
        return {
          choices: search === 'Target' ? [{ value: 'target', label: 'Target Session' }] : [],
          hasMore: false,
        }
      },
      maxItems: 5,
    })

    input.write('Target')
    input.write('\r')

    await expect(selected).resolves.toBe('target')
    expect(searches.at(-1)).toBe('Target')
    expect(searches).not.toContain(undefined)
  })

  it('bounds lazy loading work for a sparse search', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const ui = createClackUi({ input, output, interactive: true })
    let loadCalls = 0

    const selected = ui.autocomplete({
      message: 'Select a Session',
      choices: [1, 2, 3, 4, 5].map((n) => ({ value: `s${n}`, label: `Session ${n}` })),
      loadMore: () => {
        loadCalls += 1
        return {
          choices: [
            {
              value: `s${loadCalls + 5}`,
              label: `Session ${loadCalls + 5}`,
            },
          ],
          hasMore: loadCalls < 3,
        }
      },
      maxItems: 5,
    })

    input.write('x')
    input.write('\u0003')

    await expect(selected).resolves.toBeNull()
    expect(loadCalls).toBe(1)
  })

  it('filters against a choice shared searchable corpus when provided', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const ui = createClackUi({ input, output, interactive: true })

    const selected = ui.autocomplete({
      message: 'Select a Session',
      choices: [
        {
          value: 'target',
          label: 'Recent Session',
          hint: 'claude · today · pickerel',
          searchText: 'target hidden-title claude pickerel /work/pickerel 2026-07-20',
        },
      ],
    })

    input.write('/work/pickerel')
    input.write('\r')

    await expect(selected).resolves.toBe('target')
  })

  it('treats Enter with no visible match as a cancelled selection', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const ui = createClackUi({ input, output, interactive: true })

    const selected = ui.autocomplete({
      message: 'Select a Session',
      choices: [{ value: 'recent', label: 'Recent Session' }],
    })

    input.write('missing')
    input.write('\r')

    await expect(selected).resolves.toBeNull()
  })

  it('accepts Yes when Enter is pressed on a Yes-default confirmation', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const ui = createClackUi({ input, output, interactive: true })

    const confirmed = ui.confirm('Share this Session as Link-only?', true)
    input.write('\r')

    await expect(confirmed).resolves.toBe(true)
  })
})
