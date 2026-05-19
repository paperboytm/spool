import { describe, test, expect } from 'vitest'
import { resolveSpoolDataDir } from './spool-data-dir.mjs'

describe('resolveSpoolDataDir', () => {
  const home = '/Users/test'

  test('defaults to ~/.spool-dev when SPOOL_DATA_DIR is unset', () => {
    expect(resolveSpoolDataDir({}, home)).toEqual({
      value: '/Users/test/.spool-dev',
      source: 'default',
    })
  })

  test('respects a user-set SPOOL_DATA_DIR', () => {
    expect(resolveSpoolDataDir({ SPOOL_DATA_DIR: '/tmp/custom' }, home)).toEqual({
      value: '/tmp/custom',
      source: 'env',
    })
  })

  test('treats empty SPOOL_DATA_DIR as unset', () => {
    expect(resolveSpoolDataDir({ SPOOL_DATA_DIR: '' }, home)).toEqual({
      value: '/Users/test/.spool-dev',
      source: 'default',
    })
  })
})
