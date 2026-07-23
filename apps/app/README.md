# Legacy Electron implementation

This directory is retained only as a historical implementation reference while Spool completes its
transition to the installed CLI and public Web product.

The Electron app is deliberately excluded from the pnpm workspace, formatting and linting, CI,
tests, builds, packaging, signing, notarization, and releases. Its source and old test fixtures are
not maintained product surfaces. New product work belongs in `apps/cli`, `apps/web`, or
`apps/backend`.

Use repository history when a runnable version of the retired app is needed. Do not restore an
Electron automation path without an explicit product decision that also updates `DESIGN.md`.
