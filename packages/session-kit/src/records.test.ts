import { describe, expect, it } from 'vite-plus/test'

import {
  backupSessionRecord,
  canonicalizeRecord,
  restoreSessionRecord,
  sessionRecordData,
  splitRecords,
} from './records.js'

describe('splitRecords', () => {
  it('keeps non-empty JSONL records and accepts CRLF and a missing final newline', () => {
    expect(splitRecords(' {"i":1}\r\n\r\n{"i":2}')).toEqual([' {"i":1}', '{"i":2}'])
  })
})

describe('canonicalizeRecord', () => {
  it('produces one golden OID across key-order and whitespace variants', async () => {
    const left = await canonicalizeRecord('{ "b": 2, "a": { "d": 4, "c": 3 } }')
    const right = await canonicalizeRecord('{"a":{"c":3,"d":4},"b":2}')

    expect(left).toEqual({
      data: '{"a":{"c":3,"d":4},"b":2}',
      oid: 'c461c47a913352f1a21e3f2ea49e1fd34754c0dc12cb7366e4636d5e186c6c6e',
    })
    expect(right).toEqual(left)
  })

  it('rewrites workspace and home occurrences before hashing', async () => {
    const canonical = await canonicalizeRecord(
      '{"path":"/Users/test/work/demo/src/a.ts","home":"/Users/test/.config","nested":{"again":"/Users/test/work/demo"}}',
      { workspaceRoot: '/Users/test/work/demo', homeDir: '/Users/test' },
    )

    expect(canonical).toEqual({
      data: '{"home":"$SPOOL_HOME/.config","nested":{"again":"$SPOOL_WS"},"path":"$SPOOL_WS/src/a.ts"}',
      oid: '7d88db714a7d6a04433ee18daab073c8bb6f1a4b96d98257edf310f2079febe7',
    })
  })

  it('gives equivalent machines the same OID', async () => {
    const mac = await canonicalizeRecord(
      '{"cwd":"/Users/alice/project","file":"/Users/alice/project/src/a.ts","cache":"/Users/alice/.cache"}',
      { workspaceRoot: '/Users/alice/project', homeDir: '/Users/alice' },
    )
    const linux = await canonicalizeRecord(
      '{"cache":"/home/bob/.cache","file":"/home/bob/project/src/a.ts","cwd":"/home/bob/project"}',
      { workspaceRoot: '/home/bob/project', homeDir: '/home/bob' },
    )

    expect(mac).toEqual(linux)
  })

  it('rejects a high surrogate at the end of a JSON string', async () => {
    await expect(canonicalizeRecord('{"key":"\\ud800"}')).rejects.toThrow('lone surrogates')
  })
})

describe('PortableSessionBackupV1', () => {
  it('preserves direct provider JSON key order, whitespace, and number lexemes', async () => {
    const source =
      '{ "trailing": 1.2300, "exponent": 1e3, "negativeZero": -0, "large": 9007199254740993 }'
    const backup = await backupSessionRecord(source)

    expect(backup.version).toBe(1)
    expect(backup.data).toBe(source)
    expect(sessionRecordData(backup)).toBe(source)
  })

  it('normalizes escaped path spellings only inside affected JSON string tokens', async () => {
    const backup = await backupSessionRecord(
      '{ "\\/Users\\/test\\/work\\/demo": 1.2300, "unicode": "\\u002fUsers\\u002ftest\\u002fwork\\u002fdemo/src" }',
      { workspaceRoot: '/Users/test/work/demo', homeDir: '/Users/test' },
    )

    expect(sessionRecordData(backup)).toBe('{ "$SPOOL_WS": 1.2300, "unicode": "$SPOOL_WS/src" }')
  })

  it('keeps the established reserved-token restore behavior', () => {
    expect(
      restoreSessionRecord(
        '{"literal":"$SPOOL_ESC_WS","cwd":"$SPOOL_WS"}',
        '/workspace',
        '/home/resumer',
      ),
    ).toBe('{"literal":"$SPOOL_ESC_WS","cwd":"/workspace"}')
  })

  it('rejects local roots containing reserved portability tokens', async () => {
    await expect(
      backupSessionRecord('{"cwd":"safe"}', {
        workspaceRoot: '/tmp/$SPOOL_WS/project',
        homeDir: '/tmp',
      }),
    ).rejects.toThrow('reserved Spool portability tokens')
  })

  it('validates strings hidden behind duplicate provider keys', async () => {
    await expect(backupSessionRecord('{"key":"\\ud800","key":"safe"}')).rejects.toThrow(
      'lone surrogates',
    )
  })
})
