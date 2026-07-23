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
    ignorePatterns: ['apps/app/**', 'apps/web/src/routeTree.gen.ts'],
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
      'apps/app/**',
      'apps/web/src/routeTree.gen.ts',
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
