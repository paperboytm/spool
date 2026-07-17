// Build-time constants injected via `define` in electron.vite.config.ts.
// esbuild replaces them with literals at build time; this declaration is
// what lets bare `tsc --noEmit` typecheck the sources that reference them.

/** True only in e2e builds (SPOOL_E2E_TEST=1) — see electron.vite.config.ts. */
declare const __SPOOL_E2E__: boolean
