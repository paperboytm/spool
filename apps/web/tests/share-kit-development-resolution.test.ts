import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')
const WEB_ROOT = resolve(PROJECT_ROOT, 'apps/web')

const ENTRYPOINTS = [
  {
    specifier: '@spool/share-kit',
    development: 'packages/share-kit/src/index.ts',
    production: 'packages/share-kit/dist/index.js',
  },
  {
    specifier: '@spool/share-kit/progressive',
    development: 'packages/share-kit/src/progressive.ts',
    production: 'packages/share-kit/dist/progressive.js',
  },
  {
    specifier: '@spool/share-kit/timeline',
    development: 'packages/share-kit/src/timeline.ts',
    production: 'packages/share-kit/dist/timeline.js',
  },
  {
    specifier: '@spool/share-kit/spool-document',
    development: 'packages/share-kit/src/spool-document.ts',
    production: 'packages/share-kit/dist/spool-document.js',
  },
] as const

function resolveEntrypoints(specifiers: string[], conditions: string[] = []) {
  const script = `
    const specifiers = ${JSON.stringify(specifiers)};
    console.log(JSON.stringify(Object.fromEntries(
      specifiers.map((specifier) => [specifier, import.meta.resolve(specifier)]),
    )));
  `

  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        ...conditions.map((condition) => `--conditions=${condition}`),
        '--input-type=module',
        '--eval',
        script,
      ],
      {
        cwd: WEB_ROOT,
        encoding: 'utf8',
      },
    ),
  ) as Record<string, string>
}

function expectResolvedEntrypoints(
  target: 'development' | 'production',
  conditions: string[] = [],
) {
  const resolved = resolveEntrypoints(
    ENTRYPOINTS.map(({ specifier }) => specifier),
    conditions,
  )

  for (const { specifier, [target]: expectedPath } of ENTRYPOINTS) {
    expect(fileURLToPath(resolved[specifier] ?? '')).toBe(resolve(PROJECT_ROOT, expectedPath))
  }
}

describe('share-kit development entrypoints', () => {
  it('resolve to source before the build watcher has produced dist', () => {
    expectResolvedEntrypoints('development', ['development'])
  })

  it('keeps default imports on the built output', () => {
    expectResolvedEntrypoints('production')
  })
})
