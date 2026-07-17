import { describe, expect, it } from 'vitest'
import { canonicalizeRecord } from './records.js'
import { chainRoots, sequenceRoot } from './sequence.js'

describe('sequence hashing', () => {
  it('returns golden roots for every non-empty prefix and root at @n', async () => {
    const records = await Promise.all([
      canonicalizeRecord('{"i":1}'),
      canonicalizeRecord('{"i":2}'),
      canonicalizeRecord('{"i":3}'),
    ])
    const roots = await chainRoots(records.map(record => record.oid))

    expect(roots).toEqual([
      '423b3a5260865d05fe9df3c03507dfc6a63293b14bb0eab4be15f814f87565bf',
      '7c4452bbab279f54236982beb96b758ee31318b3214c36265b57576e1113102a',
      '91483db5f1bc17719029bc5dd8e030a805601928795086af39001e074ffff1e7',
    ])
    await expect(sequenceRoot(records.map(record => record.oid), 2)).resolves.toBe(roots[1])
    await expect(sequenceRoot(records.map(record => record.oid), 0)).resolves.toBe('0'.repeat(64))
  })

  it('preserves a truncated prefix and diverges at a rewritten provider record', async () => {
    const original = await Promise.all([
      canonicalizeRecord('{"type":"user","text":"one"}'),
      canonicalizeRecord('{"type":"assistant","text":"two"}'),
      canonicalizeRecord('{"type":"user","text":"three"}'),
    ])
    const rewritten = await Promise.all([
      canonicalizeRecord('{"text":"one","type":"user"}'),
      canonicalizeRecord('{ "text": "two", "type": "assistant" }'),
      canonicalizeRecord('{"type":"user","text":"changed"}'),
    ])
    const originalRoots = await chainRoots(original.map(record => record.oid))
    const rewrittenRoots = await chainRoots(rewritten.map(record => record.oid))

    expect(rewrittenRoots.slice(0, 2)).toEqual(originalRoots.slice(0, 2))
    expect(rewrittenRoots[2]).not.toBe(originalRoots[2])
    await expect(sequenceRoot(original.map(record => record.oid), 2)).resolves.toBe(originalRoots[1])
  })
})
