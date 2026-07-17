import { describe, it, expect } from 'vitest'
import { draftIdForImport } from './import-spool'

describe('draftIdForImport', () => {
  it('is deterministic for the same snapshot', async () => {
    const a = await draftIdForImport('{"hello":1}')
    const b = await draftIdForImport('{"hello":1}')
    expect(a).toBe(b)
    expect(a.startsWith('imported:')).toBe(true)
  })

  it('differs across distinct snapshots', async () => {
    const a = await draftIdForImport('{"hello":1}')
    const b = await draftIdForImport('{"hello":2}')
    expect(a).not.toBe(b)
  })
})
