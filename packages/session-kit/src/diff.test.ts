import { describe, expect, it } from 'vitest'
import { composeSessionDiff } from './diff.js'
import type { EditEvent } from './types.js'

describe('composeSessionDiff', () => {
  it('composes repeated edits into one per-file net diff with record mapping', () => {
    const initial = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n'
    const afterFirst = initial.replace('two', 'TWO')
    const afterSecond = afterFirst.replace('TWO', 'SECOND')
    const final = afterSecond.replace('nine', 'NINE')
    const events: EditEvent[] = [
      { provider: 'claude', tool: 'Edit', recordIndex: 2, resultRecordIndex: 3, path: 'src/a.ts', before: initial, after: afterFirst, replacements: [{ oldText: 'two', newText: 'TWO' }] },
      { provider: 'claude', tool: 'Edit', recordIndex: 6, resultRecordIndex: 7, path: 'src/a.ts', before: afterFirst, after: afterSecond, replacements: [{ oldText: 'TWO', newText: 'SECOND' }] },
      { provider: 'claude', tool: 'Edit', recordIndex: 10, resultRecordIndex: 11, path: 'src/a.ts', before: afterSecond, after: final, replacements: [{ oldText: 'nine', newText: 'NINE' }] },
    ]

    const diff = composeSessionDiff(events)

    expect(diff.diffstat).toEqual({ files: 1, adds: 2, dels: 2 })
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({
      path: 'src/a.ts',
      events: [2, 3, 6, 7, 10, 11],
      oldText: initial,
      newText: final,
      adds: 2,
      dels: 2,
    })
    expect(diff.files[0]?.hunks).toHaveLength(2)
    expect(diff.files[0]?.hunks[0]?.recordIndices).toEqual([2, 6])
    expect(diff.files[0]?.hunks[1]?.recordIndices).toEqual([10])
  })

  it('composes separate and overlapping patch fragments without full file snapshots', () => {
    const events: EditEvent[] = [
      { provider: 'codex', tool: 'apply_patch', recordIndex: 2, resultRecordIndex: 3, path: 'src/a.ts', replacements: [{ oldText: 'alpha\nkeep\n', newText: 'beta\nkeep\n' }] },
      { provider: 'codex', tool: 'apply_patch', recordIndex: 6, resultRecordIndex: 7, path: 'src/a.ts', replacements: [{ oldText: 'tail\nend\n', newText: 'TAIL\nend\n' }] },
      { provider: 'codex', tool: 'apply_patch', recordIndex: 10, resultRecordIndex: 11, path: 'src/a.ts', replacements: [{ oldText: 'beta\nkeep\n', newText: 'gamma\nkeep\n' }] },
    ]

    const [file] = composeSessionDiff(events).files

    expect(file?.oldText).toBe('alpha\nkeep\ntail\nend\n')
    expect(file?.newText).toBe('gamma\nkeep\nTAIL\nend\n')
    expect(file).toMatchObject({ adds: 2, dels: 2, events: [2, 3, 6, 7, 10, 11] })
    expect(file?.hunks.flatMap(hunk => hunk.recordIndices)).toEqual(expect.arrayContaining([2, 6, 10]))
  })

  it('orders Codex fragments by hunk coordinates and preserves wire line positions', () => {
    const events: EditEvent[] = [
      { provider: 'codex', tool: 'apply_patch', recordIndex: 2, resultRecordIndex: 3, path: 'src/a.ts', replacements: [{ oldText: 'late\nkeep-late\n', newText: 'LATE\nkeep-late\n', oldStart: 100, oldLines: 2, newStart: 100, newLines: 2 }] },
      { provider: 'codex', tool: 'apply_patch', recordIndex: 6, resultRecordIndex: 7, path: 'src/a.ts', replacements: [{ oldText: 'early\nkeep-early\n', newText: 'EARLY\nkeep-early\n', oldStart: 10, oldLines: 2, newStart: 10, newLines: 2 }] },
    ]

    const [file] = composeSessionDiff(events).files

    expect(file?.oldText).toBe('early\nkeep-early\nlate\nkeep-late\n')
    expect(file?.newText).toBe('EARLY\nkeep-early\nLATE\nkeep-late\n')
    expect(file?.hunks.map(hunk => [hunk.oldStart, hunk.newStart])).toEqual([[10, 10], [100, 100]])
    expect(file?.hunks.map(hunk => [
      hunk.lines.find(line => line.kind === 'del')?.oldLine,
      hunk.lines.find(line => line.kind === 'add')?.newLine,
    ])).toEqual([[10, 10], [100, 100]])
  })

  it('distinguishes repeated Codex hunk context by coordinates', () => {
    const repeated = { oldText: 'same\n', newText: 'same\nadded\n', oldLines: 1, newLines: 2 }
    const events: EditEvent[] = [{
      provider: 'codex', tool: 'apply_patch', recordIndex: 4, resultRecordIndex: 5, path: 'src/a.ts',
      replacements: [
        { ...repeated, oldStart: 10, newStart: 10 },
        { ...repeated, oldStart: 20, newStart: 21 },
      ],
    }]

    const [file] = composeSessionDiff(events).files

    expect(file?.oldText).toBe('same\nsame\n')
    expect(file?.newText).toBe('same\nadded\nsame\nadded\n')
    expect(file?.adds).toBe(2)
    expect(file?.hunks.map(hunk => [hunk.oldStart, hunk.newStart])).toEqual([[10, 10], [20, 21]])
  })

  it('maps sequential Codex coordinates back to the first pre-edit baseline', () => {
    const events: EditEvent[] = [
      { provider: 'codex', tool: 'apply_patch', recordIndex: 2, resultRecordIndex: 3, path: 'src/a.ts', replacements: [{ oldText: 'first\nkeep-first\n', newText: 'first\nextra-a\nextra-b\nkeep-first\n', oldStart: 5, oldLines: 2, newStart: 5, newLines: 4 }] },
      { provider: 'codex', tool: 'apply_patch', recordIndex: 6, resultRecordIndex: 7, path: 'src/a.ts', replacements: [{ oldText: 'later\nkeep-later\n', newText: 'LATER\nkeep-later\n', oldStart: 12, oldLines: 2, newStart: 12, newLines: 2 }] },
    ]

    const [file] = composeSessionDiff(events).files

    expect(file?.hunks.map(hunk => [hunk.oldStart, hunk.newStart])).toEqual([[5, 5], [10, 12]])
  })
})
