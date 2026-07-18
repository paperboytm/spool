import { resolve } from 'node:path'

import { defineConfig } from 'vite-plus'

const workspaceAlias = [
  {
    find: /^@spool-lab\/core$/,
    replacement: resolve(import.meta.dirname, 'packages/core/src/index.ts'),
  },
  {
    find: /^@spool-lab\/redact$/,
    replacement: resolve(import.meta.dirname, 'packages/redact/src/index.ts'),
  },
  {
    find: /^@spool-lab\/session-kit$/,
    replacement: resolve(import.meta.dirname, 'packages/session-kit/src/index.ts'),
  },
  {
    find: /^@spool-lab\/session-view$/,
    replacement: resolve(import.meta.dirname, 'packages/session-view/src/index.ts'),
  },
  {
    find: /^@spool\/share-kit$/,
    replacement: resolve(import.meta.dirname, 'packages/share-kit/src/index.ts'),
  },
]

export default defineConfig({
  resolve: {
    alias: workspaceAlias,
  },
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    singleQuote: true,
    semi: false,
    sortImports: {},
    sortPackageJson: true,
    sortTailwindcss: {},
  },
  lint: {
    plugins: ['typescript'],
    categories: {
      correctness: 'off',
    },
    env: {
      builtin: true,
    },
    ignorePatterns: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/test-results/**',
      '**/.turbo/**',
      'apps/app/release/**',
      'packages/connectors/**/dist/**',
    ],
    rules: {
      'typescript/no-floating-promises': [
        'error',
        {
          ignoreVoid: true,
        },
      ],
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    overrides: [
      {
        files: ['apps/app/src/main/**/*.ts'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              paths: [
                {
                  name: 'node:child_process',
                  importNames: ['execSync', 'spawnSync', 'execFileSync'],
                  message:
                    'Sync child_process APIs block the main-process event loop and produce a launch beachball. Use the async equivalents (and Promise.all when multiple lookups are independent), or move the work into a worker_thread.',
                },
                {
                  name: 'child_process',
                  importNames: ['execSync', 'spawnSync', 'execFileSync'],
                  message:
                    'Sync child_process APIs block the main-process event loop and produce a launch beachball. Use the async equivalents (and Promise.all when multiple lookups are independent), or move the work into a worker_thread.',
                },
              ],
            },
          ],
        },
      },
      {
        files: [
          'apps/app/src/main/e2e-mode/e2e-mode-clean.test.ts',
          'apps/app/src/main/terminal.test.ts',
        ],
        rules: {
          'no-restricted-imports': 'off',
        },
      },
    ],
    options: {
      typeAware: true,
      // Package tsconfigs intentionally exclude tests and generated files.
      // Keep type-aware linting here; `vp run -r typecheck` owns diagnostics.
      typeCheck: false,
    },
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
  },
})
