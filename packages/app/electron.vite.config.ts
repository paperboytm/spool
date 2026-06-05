import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const coreAlias = {
  '@spool-lab/core': resolve(__dirname, '../core/dist/index.js'),
  '@spool-lab/redact': resolve(__dirname, '../redact/dist/index.js'),
}

// better-sqlite3 uses 'bindings' at runtime to locate the .node native addon.
// It must NOT be bundled — it must stay as a real require() in the output.
function nativeExternalPlugin(): Plugin {
  return {
    name: 'native-external',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'better-sqlite3' || id.startsWith('better-sqlite3/')) {
        return { id, external: true }
      }
      return null
    },
  }
}

// Main-process env vars whose values get inlined into the bundle at
// build time via Rollup `define`. Renderer reads its own env via
// `import.meta.env.VITE_*`, but the main process bundle is plain CJS —
// it has no equivalent at runtime, so we substitute `process.env.X`
// references with literal strings before they reach the output.
//
// Why this list lives in build config, not in a runtime dotenv loader:
//   1. Prod is the constraint. An Electron app double-clicked from
//      /Applications inherits a minimal env (often no PATH even). The
//      only robust delivery is build-time inlining + CI providing the
//      values at build.
//   2. PKCE public-client `client_id`s are NOT secrets per RFC 8252,
//      so baking them into the binary is fine. The web flow's
//      `client_secret` never reaches this bundle — it stays in
//      share-backend's wrangler secrets.
//   3. Dev gets the same path: values come from `.env.development.local`
//      (same file the renderer reads, via Vite's `loadEnv`), inlined at
//      bundle time on each dev start. No drift between dev / prod
//      delivery mechanism.
//
// To add a new one: append the env var name here AND add the entry to
// `.env.development.local.example`.
const MAIN_INLINE_ENV: readonly string[] = [
  'SPOOL_GOOGLE_CLIENT_ID_DESKTOP',
  'SPOOL_GOOGLE_CLIENT_ID_WEB',
  // Google's installed-app OAuth requires client_secret at the token
  // endpoint even with PKCE. Google's docs explicitly note it isn't
  // truly secret for distributed binaries — fine to inline.
  'SPOOL_GOOGLE_CLIENT_SECRET_DESKTOP',
  // Backend origin for `/api/auth/sign-in-with-id-token`, `/api/me`, etc.
  // In dev this is the local wrangler `http://localhost:8788`; in prod
  // it's the spool.pro Pages deployment. Without this inlined the main
  // bundle defaults to https://spool.pro and dev sign-in 404s.
  'SPOOL_SHARE_BACKEND',
]

function resolveMainEnv(mode: string): Map<string, string> {
  // Read .env, .env.local, .env.[mode], .env.[mode].local from the
  // package root. Empty prefix loads ALL vars (Vite's default `VITE_`
  // prefix would only load renderer-shaped names). We then narrow to
  // the documented main-process list to avoid accidentally inlining
  // shell secrets that happen to be in the user's env.
  //
  // Priority: process.env wins over file. That lets CI override
  // committed defaults without checking values into the repo —
  // `electron-vite build --mode production` with the env set inline
  // produces the same bundle as a `.env.production` file would, but
  // the values never touch git history.
  //
  // Empty / missing values are intentionally OMITTED from the map.
  // The plugin then leaves `process.env['X']` references intact, so
  // any runtime fallback the calling code has (e.g. `?? DEFAULT_URL`)
  // can fire. If we inlined an empty string the fallback would never
  // see undefined and we'd silently ship a broken default (the
  // `SPOOL_SHARE_BACKEND` regression that pointed dev at `''`).
  const fileEnv = loadEnv(mode, __dirname, '')
  const out = new Map<string, string>()
  for (const key of MAIN_INLINE_ENV) {
    const value = process.env[key] ?? fileEnv[key] ?? ''
    if (value) out.set(key, value)
  }
  return out
}

/**
 * Inline-main-env plugin.
 *
 * Vite's built-in `define` only replaces `process.env.X` (dot-notation
 * member access). The Spool codebase consistently uses bracket-notation
 * (`process.env['X']`) for env reads — that's the idiomatic TS pattern
 * when `noUncheckedIndexedAccess` is on. So a plain `define` quietly
 * misses every call site and the main bundle still hits a runtime
 * `process.env` lookup that returns undefined.
 *
 * This plugin runs before the rollup transform and substitutes all
 * three syntactic forms — `process.env.X`, `process.env['X']`,
 * `process.env["X"]` — for the documented MAIN_INLINE_ENV allowlist.
 * Anything outside that list flows through unchanged.
 */
function inlineMainEnvPlugin(env: Map<string, string>): Plugin {
  return {
    name: 'inline-main-env',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.[mc]?[jt]sx?$/.test(id)) return null
      if (id.includes('node_modules')) return null
      let out = code
      let changed = false
      for (const [key, value] of env) {
        const literal = JSON.stringify(value)
        // process.env.X — match a word boundary so STAGING_X doesn't
        // collide with a key X.
        const dotRe = new RegExp(`process\\.env\\.${key}\\b`, 'g')
        // process.env['X'] and process.env["X"]
        const bracketRe = new RegExp(`process\\.env\\[(['"])${key}\\1\\]`, 'g')
        const replaced = out.replace(dotRe, () => { changed = true; return literal })
          .replace(bracketRe, () => { changed = true; return literal })
        out = replaced
      }
      return changed ? { code: out, map: null } : null
    },
  }
}

export default defineConfig(({ mode }) => ({
  main: {
    // Bundle pure-ESM deps instead of externalizing them. When a dep is
    // marked external, electron-vite emits a CJS `require()`, and pure-ESM
    // modules (no `module.exports = ` shim, no `__esModule` marker) come
    // back from `require()` as a namespace whose default sits on `.default`
    // — so `import Store from 'x'` binds to the namespace and `new Store()`
    // throws "Store is not a constructor". Bundling lets Vite handle the
    // interop. better-sqlite3 still has to stay external (it loads a .node
    // native addon via the 'bindings' shim).
    //   - @spool-lab/core / @spool-lab/redact: in-tree workspace ESM.
    //   - electron-store@10: pure ESM upstream.
    plugins: [
      inlineMainEnvPlugin(resolveMainEnv(mode)),
      externalizeDepsPlugin({ exclude: ['@spool-lab/core', '@spool-lab/redact', 'electron-store'] }),
      nativeExternalPlugin(),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'sync-worker': resolve(__dirname, 'src/main/sync-worker.ts'),
          'scan-worker-thread': resolve(__dirname, 'src/main/scan-worker-thread.ts'),
          'mutation-worker-thread': resolve(__dirname, 'src/main/mutation-worker-thread.ts'),
        },
      },
    },
    resolve: { alias: coreAlias },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@spool-lab/core', '@spool-lab/redact'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // Hidden Privacy Filter inference window has its own preload —
          // exposes a narrow `pfBridge` (no Spool app surface) so the
          // inference renderer can't reach the main app's IPC channels.
          inference: resolve(__dirname, 'src/preload/inference.ts'),
        },
      },
    },
    resolve: { alias: coreAlias },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // Read env files (.env, .env.development.local, etc.) from the
    // package root, not the renderer source dir. Without this, Vite
    // scopes envDir to `root` and a sensible-looking
    // `packages/app/.env.development.local` is silently ignored.
    envDir: __dirname,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Hidden PF inference window. Both the HTML and its TS entry
          // (`src/renderer/inference/pf-inference.ts`) live inside the
          // renderer root, so the dev server resolves the script src
          // via a normal URL — no `@fs/` escape hatch, no fs.allow
          // whitelist needed. Earlier revisions split HTML and TS
          // across `src/renderer/` and `src/inference/`; the seam in
          // the middle silently SPA-fallbacked into the main app on
          // every dev start, hanging pf:ready forever.
          'pf-inference': resolve(__dirname, 'src/renderer/pf-inference.html'),
        },
      },
    },
    resolve: { alias: coreAlias },
    plugins: [react(), tailwindcss()],
  },
}))
