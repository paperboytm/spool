// Repository-only CLI entrypoint. Installed `spool` keeps its production
// default; `pnpm spool` talks to the local Hub unless the caller explicitly
// selects another one.
process.env['SPOOL_HUB_URL'] ||= 'http://localhost:8788'

await import('./ensure-better-sqlite3-node.mjs')
await import('../apps/cli/bin/spool.js')
