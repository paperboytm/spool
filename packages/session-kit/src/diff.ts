import type {
  DiffHunk,
  DiffLine,
  EditEvent,
  SessionDiff,
  SessionFileDiff,
  TextReplacement,
} from './types.js'

interface DiffAtom {
  kind: 'equal' | 'add' | 'del'
  line: string
}

interface TrackedLine {
  line: string
  originalIndices: number[]
  recordIndices: number[]
}

interface PositionedDiffLine extends DiffLine {
  beforeOld: number
  beforeNew: number
}

interface InferredText {
  text: string
  occurrenceByReplacement: ReadonlyMap<TextReplacement, number>
}

interface InferredFragment {
  initial: string
  current: string
  oldStart: number
  order: number
}

const HUNK_CONTEXT = 2

export function composeSessionDiff(events: readonly EditEvent[]): SessionDiff {
  const grouped = new Map<string, EditEvent[]>()
  for (const event of events) {
    const existing = grouped.get(event.path)
    if (existing) existing.push(event)
    else grouped.set(event.path, [event])
  }

  const files: SessionFileDiff[] = []
  let totalAdds = 0
  let totalDels = 0

  for (const [path, fileEvents] of grouped) {
    fileEvents.sort(
      (left, right) =>
        left.recordIndex - right.recordIndex || left.resultRecordIndex - right.resultRecordIndex,
    )
    const file = composeFile(path, fileEvents)
    files.push(file)
    totalAdds += file.adds
    totalDels += file.dels
  }

  return {
    files,
    diffstat: { files: files.length, adds: totalAdds, dels: totalDels },
  }
}

function composeFile(path: string, events: readonly EditEvent[]): SessionFileDiff {
  const first = events[0]
  if (!first) {
    return { path, events: [], oldText: '', newText: '', hunks: [], adds: 0, dels: 0 }
  }

  const inferred = first.before === undefined ? inferInitialText(events) : null
  const oldText = first.before ?? inferred?.text ?? ''
  const originalLines = splitLines(oldText)
  let tracked = originalLines.map(
    (line, index): TrackedLine => ({
      line,
      originalIndices: [index],
      recordIndices: [],
    }),
  )
  const deletedBy = new Map<number, Set<number>>()

  for (const event of events) {
    const currentText = tracked.map((item) => item.line).join('')
    const after =
      event.after ??
      applyReplacements(currentText, event.replacements, inferred?.occurrenceByReplacement)
    tracked = applyTrackedChange(tracked, after, event.recordIndex, deletedBy)
  }

  const newText = tracked.map((item) => item.line).join('')
  const positioned = positionFinalDiff(originalLines, tracked, deletedBy)
  const adds = positioned.filter((line) => line.kind === 'add').length
  const dels = positioned.filter((line) => line.kind === 'del').length
  const usesFragments = first.before === undefined
  const hunks = applyKnownCoordinates(
    makeHunks(positioned, usesFragments ? 0 : HUNK_CONTEXT),
    events,
    usesFragments,
  )
  // Both call and result indices: this is the reader's fetch list for
  // reconstructing the file's edits client-side (pairing needs both records).
  const eventIndices = [
    ...new Set(events.flatMap((event) => [event.recordIndex, event.resultRecordIndex])),
  ].sort(numberAscending)

  return { path, events: eventIndices, oldText, newText, hunks, adds, dels }
}

function applyTrackedChange(
  current: readonly TrackedLine[],
  afterText: string,
  recordIndex: number,
  deletedBy: Map<number, Set<number>>,
): TrackedLine[] {
  const atoms = diffLines(
    current.map((item) => item.line),
    splitLines(afterText),
  )
  const result: TrackedLine[] = []
  let oldIndex = 0
  let deleted: TrackedLine[] = []
  let added: string[] = []

  const flush = (): void => {
    if (deleted.length === 0 && added.length === 0) return
    const lineage = new Set<number>([recordIndex])
    for (const item of deleted) {
      for (const sourceRecord of item.recordIndices) lineage.add(sourceRecord)
    }
    const recordIndices = [...lineage].sort(numberAscending)
    for (const item of deleted) {
      for (const originalIndex of item.originalIndices) {
        const existing = deletedBy.get(originalIndex) ?? new Set<number>()
        for (const sourceRecord of recordIndices) existing.add(sourceRecord)
        deletedBy.set(originalIndex, existing)
      }
    }
    for (const line of added) {
      result.push({ line, originalIndices: [], recordIndices })
    }
    deleted = []
    added = []
  }

  for (const atom of atoms) {
    if (atom.kind === 'equal') {
      flush()
      const retained = current[oldIndex]
      if (retained) result.push(retained)
      oldIndex += 1
    } else if (atom.kind === 'del') {
      const removed = current[oldIndex]
      if (removed) deleted.push(removed)
      oldIndex += 1
    } else {
      added.push(atom.line)
    }
  }
  flush()
  return result
}

function positionFinalDiff(
  originalLines: readonly string[],
  finalLines: readonly TrackedLine[],
  deletedBy: ReadonlyMap<number, ReadonlySet<number>>,
): PositionedDiffLine[] {
  const atoms = diffLines(
    originalLines,
    finalLines.map((item) => item.line),
  )
  const result: PositionedDiffLine[] = []
  let oldIndex = 0
  let newIndex = 0

  for (const atom of atoms) {
    const beforeOld = oldIndex
    const beforeNew = newIndex
    if (atom.kind === 'equal') {
      result.push({
        kind: 'context',
        text: stripLineEnding(atom.line),
        recordIndices: [],
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
        beforeOld,
        beforeNew,
      })
      oldIndex += 1
      newIndex += 1
    } else if (atom.kind === 'del') {
      result.push({
        kind: 'del',
        text: stripLineEnding(atom.line),
        recordIndices: [...(deletedBy.get(oldIndex) ?? [])].sort(numberAscending),
        oldLine: oldIndex + 1,
        beforeOld,
        beforeNew,
      })
      oldIndex += 1
    } else {
      result.push({
        kind: 'add',
        text: stripLineEnding(atom.line),
        recordIndices: finalLines[newIndex]?.recordIndices ?? [],
        newLine: newIndex + 1,
        beforeOld,
        beforeNew,
      })
      newIndex += 1
    }
  }

  return result
}

function makeHunks(lines: readonly PositionedDiffLine[], context: number): DiffHunk[] {
  const changed = lines.flatMap((line, index) => (line.kind === 'context' ? [] : [index]))
  if (changed.length === 0) return []

  const windows: Array<{ start: number; end: number }> = []
  for (const index of changed) {
    const start = Math.max(0, index - context)
    const end = Math.min(lines.length - 1, index + context)
    const previous = windows[windows.length - 1]
    if (previous && start <= previous.end + 1) previous.end = Math.max(previous.end, end)
    else windows.push({ start, end })
  }

  return windows.map(({ start, end }) => {
    const selected = lines.slice(start, end + 1)
    const first = selected[0] as PositionedDiffLine
    const oldLines = selected.filter((line) => line.kind !== 'add').length
    const newLines = selected.filter((line) => line.kind !== 'del').length
    const recordIndices = [...new Set(selected.flatMap((line) => line.recordIndices))].sort(
      numberAscending,
    )
    return {
      oldStart: first.beforeOld + 1,
      oldLines,
      newStart: first.beforeNew + 1,
      newLines,
      lines: selected.map(stripPosition),
      recordIndices,
    }
  })
}

function stripPosition(line: PositionedDiffLine): DiffLine {
  const { beforeOld: _beforeOld, beforeNew: _beforeNew, ...publicLine } = line
  return publicLine
}

function applyReplacements(
  initial: string,
  replacements: readonly TextReplacement[],
  occurrenceByReplacement: ReadonlyMap<TextReplacement, number> | undefined,
): string {
  let result = initial
  for (const replacement of replacements) {
    if (replacement.oldText === '') continue
    if (replacement.replaceAll) {
      result = result.split(replacement.oldText).join(replacement.newText)
      continue
    }
    const occurrences = findOccurrences(result, replacement.oldText)
    const occurrence = occurrenceByReplacement?.get(replacement) ?? 0
    const index = occurrences[Math.min(occurrence, occurrences.length - 1)] ?? -1
    if (index >= 0) {
      result =
        result.slice(0, index) +
        replacement.newText +
        result.slice(index + replacement.oldText.length)
    }
  }
  return result
}

function inferInitialText(events: readonly EditEvent[]): InferredText {
  const fragments: InferredFragment[] = []
  const targetByReplacement = new Map<TextReplacement, InferredFragment>()
  let order = 0

  for (const event of events) {
    for (const replacement of event.replacements) {
      if (replacement.oldText === '') continue
      const candidates = fragments.filter((fragment) =>
        fragment.current.includes(replacement.oldText),
      )
      let target =
        replacement.oldStart === undefined
          ? candidates[0]
          : candidates.find((fragment) =>
              coordinateFallsWithin(fragment, replacement.oldStart as number),
            )
      if (!target) {
        target = {
          initial: replacement.oldText,
          current: replacement.oldText,
          oldStart: replacement.oldStart ?? 1_000_000_000 + order,
          order,
        }
        order += 1
        fragments.push(target)
      }
      targetByReplacement.set(replacement, target)
      target.current = replacement.replaceAll
        ? target.current.split(replacement.oldText).join(replacement.newText)
        : replaceFirst(target.current, replacement.oldText, replacement.newText)
    }
  }

  fragments.sort((left, right) => left.oldStart - right.oldStart || left.order - right.order)
  const occurrenceByReplacement = new Map<TextReplacement, number>()
  for (const event of events) {
    for (const replacement of event.replacements) {
      const target = targetByReplacement.get(replacement)
      if (!target) continue
      const candidates = fragments.filter(
        (fragment) => fragment.current.includes(replacement.oldText) || fragment === target,
      )
      occurrenceByReplacement.set(replacement, Math.max(0, candidates.indexOf(target)))
    }
  }
  return {
    text: fragments.map((fragment) => fragment.initial).join(''),
    occurrenceByReplacement,
  }
}

function replaceFirst(value: string, search: string, replacement: string): string {
  const index = value.indexOf(search)
  if (index < 0) return value
  return value.slice(0, index) + replacement + value.slice(index + search.length)
}

function coordinateFallsWithin(fragment: InferredFragment, oldStart: number): boolean {
  const lines = Math.max(1, splitLines(fragment.current).length)
  return oldStart >= fragment.oldStart && oldStart < fragment.oldStart + lines
}

function findOccurrences(value: string, search: string): number[] {
  const result: number[] = []
  let from = 0
  while (from <= value.length - search.length) {
    const index = value.indexOf(search, from)
    if (index < 0) break
    result.push(index)
    from = index + Math.max(1, search.length)
  }
  return result
}

function applyKnownCoordinates(
  hunks: readonly DiffHunk[],
  events: readonly EditEvent[],
  usesFragments: boolean,
): DiffHunk[] {
  if (!usesFragments || hunks.length === 0) return [...hunks]
  const coordinateChanges: Array<{ baseStart: number; delta: number }> = []
  const positioned: Array<{
    event: EditEvent
    baseStart: number
    baseEnd: number
  }> = []
  const sortedEvents = events.slice().sort((left, right) => left.recordIndex - right.recordIndex)
  for (const event of sortedEvents) {
    const eventChanges: Array<{ baseStart: number; delta: number }> = []
    for (const replacement of event.replacements) {
      if (replacement.oldStart === undefined || replacement.newStart === undefined) continue
      const baseStart = mapCurrentLineToBaseline(replacement.oldStart, coordinateChanges)
      const oldLines = replacement.oldLines ?? 1
      eventChanges.push({
        baseStart,
        delta: (replacement.newLines ?? 1) - oldLines,
      })
      positioned.push({ event, baseStart, baseEnd: baseStart + Math.max(1, oldLines) - 1 })
    }
    coordinateChanges.push(...eventChanges)
  }
  if (positioned.length === 0) return [...hunks]

  positioned.sort(
    (left, right) =>
      left.baseStart - right.baseStart || left.event.recordIndex - right.event.recordIndex,
  )
  const regions: Array<{
    oldStart: number
    oldEnd: number
    newStart: number
    lastRecordIndex: number
  }> = []
  for (const item of positioned) {
    const oldStart = item.baseStart
    const oldEnd = item.baseEnd
    const previous = regions[regions.length - 1]
    if (previous && oldStart <= previous.oldEnd && oldEnd >= previous.oldStart) {
      previous.oldStart = Math.min(previous.oldStart, oldStart)
      previous.oldEnd = Math.max(previous.oldEnd, oldEnd)
      if (item.event.recordIndex >= previous.lastRecordIndex) {
        previous.newStart = finalLineForBaseline(oldStart, coordinateChanges)
        previous.lastRecordIndex = item.event.recordIndex
      }
    } else {
      regions.push({
        oldStart,
        oldEnd,
        newStart: finalLineForBaseline(oldStart, coordinateChanges),
        lastRecordIndex: item.event.recordIndex,
      })
    }
  }
  if (regions.length !== hunks.length) return [...hunks]
  return hunks.map((hunk, index) => {
    const region = regions[index] as { oldStart: number; newStart: number }
    const oldOffset = region.oldStart - hunk.oldStart
    const newOffset = region.newStart - hunk.newStart
    return {
      ...hunk,
      oldStart: region.oldStart,
      newStart: region.newStart,
      lines: hunk.lines.map((line) => ({
        ...line,
        ...(line.oldLine === undefined ? {} : { oldLine: line.oldLine + oldOffset }),
        ...(line.newLine === undefined ? {} : { newLine: line.newLine + newOffset }),
      })),
    }
  })
}

function mapCurrentLineToBaseline(
  currentLine: number,
  changes: readonly { baseStart: number; delta: number }[],
): number {
  let baseline = currentLine
  for (let iteration = 0; iteration <= changes.length; iteration += 1) {
    const deltaBefore = changes
      .filter((change) => change.baseStart < baseline)
      .reduce((total, change) => total + change.delta, 0)
    const next = currentLine - deltaBefore
    if (next === baseline) break
    baseline = next
  }
  return baseline
}

function finalLineForBaseline(
  baselineLine: number,
  changes: readonly { baseStart: number; delta: number }[],
): number {
  return (
    baselineLine +
    changes
      .filter((change) => change.baseStart < baselineLine)
      .reduce((total, change) => total + change.delta, 0)
  )
}

function splitLines(value: string): string[] {
  if (value.length === 0) return []
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\n') {
      lines.push(value.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < value.length) lines.push(value.slice(start))
  return lines
}

function stripLineEnding(line: string): string {
  return line.endsWith('\r\n') ? line.slice(0, -2) : line.endsWith('\n') ? line.slice(0, -1) : line
}

function diffLines(before: readonly string[], after: readonly string[]): DiffAtom[] {
  const max = before.length + after.length
  let frontier = new Map<number, number>([[1, 0]])
  const trace: Array<Map<number, number>> = []

  for (let distance = 0; distance <= max; distance += 1) {
    trace.push(new Map(frontier))
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY
      const right = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY
      let x = diagonal === -distance || (diagonal !== distance && right < down) ? down : right + 1
      if (!Number.isFinite(x)) x = 0
      let y = x - diagonal
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1
        y += 1
      }
      frontier.set(diagonal, x)
      if (x >= before.length && y >= after.length) return backtrack(trace, before, after)
    }
  }

  return []
}

function backtrack(
  trace: readonly ReadonlyMap<number, number>[],
  before: readonly string[],
  after: readonly string[],
): DiffAtom[] {
  let x = before.length
  let y = after.length
  const reversed: DiffAtom[] = []

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance] as ReadonlyMap<number, number>
    const diagonal = x - y
    const down = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY
    const right = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY
    const previousDiagonal =
      diagonal === -distance || (diagonal !== distance && right < down)
        ? diagonal + 1
        : diagonal - 1
    const previousX = frontier.get(previousDiagonal) ?? 0
    const previousY = previousX - previousDiagonal

    while (x > previousX && y > previousY) {
      reversed.push({ kind: 'equal', line: before[x - 1] as string })
      x -= 1
      y -= 1
    }
    if (distance === 0) break

    if (x === previousX) {
      reversed.push({ kind: 'add', line: after[y - 1] as string })
      y -= 1
    } else {
      reversed.push({ kind: 'del', line: before[x - 1] as string })
      x -= 1
    }
  }

  return reversed.reverse()
}

function numberAscending(left: number, right: number): number {
  return left - right
}
