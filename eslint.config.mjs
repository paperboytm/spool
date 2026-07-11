// Minimal ESLint setup focused on a single guarantee: the Electron
// main-process JS thread must never call a synchronous shell-exec API.
// Sync exec on the main thread blocks the AppKit event loop and
// produces the launch beachball we saw in v0.4.17. That regression is
// the reason this config exists.
//
// We deliberately do NOT lint the whole codebase — the project relies
// on TypeScript's strict mode for the bulk of correctness, and a broad
// ESLint rollout risks noise that drowns out the targeted rule below.
// Add more rules here only when there is a concrete recurring bug
// they would have caught.

import tsParser from '@typescript-eslint/parser'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/test-results/**',
      '**/.turbo/**',
      'packages/app/release/**',
      'packages/connectors/**/dist/**',
    ],
  },
  {
    files: ['packages/app/src/main/**/*.ts'],
    ignores: ['packages/app/src/main/**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Sync `child_process` APIs in the main process block the
      // AppKit event loop until they return. On a machine with a
      // heavy .zshrc this can be multiple seconds — long enough for
      // macOS to surface the beachball. Use `exec`/`spawn` (callback
      // form) and `promisify` them, or push the work onto a
      // worker_thread.
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'node:child_process',
            importNames: ['execSync', 'spawnSync', 'execFileSync'],
            message: 'Sync child_process APIs block the main-process event loop and produce a launch beachball. Use the async equivalents (and Promise.all when multiple lookups are independent), or move the work into a worker_thread.',
          },
          {
            name: 'child_process',
            importNames: ['execSync', 'spawnSync', 'execFileSync'],
            message: 'Sync child_process APIs block the main-process event loop and produce a launch beachball. Use the async equivalents (and Promise.all when multiple lookups are independent), or move the work into a worker_thread.',
          },
        ],
      }],
    },
  },
]
