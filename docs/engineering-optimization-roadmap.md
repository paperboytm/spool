# Spool Engineering Optimization Roadmap

> Status: Proposed  
> Updated: 2026-07-12  
> Base: `main@049c4b2`  
> Intended implementer: `sol high`

## 1. Objective

This document turns the July 2026 repository audit into an implementation plan.
The work should improve correctness, developer feedback time, interactive search
latency, build determinism, and desktop package size without changing Spool's
privacy model or user-facing behavior.

The work is deliberately split into small PRs. Do not combine the TypeScript,
search, build, and packaging changes into one migration PR.

## 2. Current Baseline

### 2.1 Toolchain

- The workspace currently resolves TypeScript `5.9.3`, although manifests use a
  mixture of `^5.7.3` and `^5.9.3`.
- npm currently publishes TypeScript `7.0.2` as `latest`. It is the native
  compiler and exposes the normal `tsc` command.
- The repository does not import the TypeScript compiler API. This removes one
  of the main blockers to the native compiler.
- `@typescript-eslint/parser@8.59.3`, including the latest 8.x release checked
  during the audit, declares TypeScript support only through `<6.1.0`.
- Oxlint `1.73.0` plus `oxlint-tsgolint` `0.24.0` supports TypeScript 7
  type-aware linting.

### 2.2 Type-check Baseline

The existing recursive `typecheck` scripts pass under TypeScript 5.9.3, but
they cover only five packages. Packages without a type-check gate already have
errors:

- `packages/app/src/main/index.ts:732` uses the build-time global
  `__SPOOL_E2E__` without a TypeScript declaration.
- `packages/landing/pages/index.tsx:140` reads `active` from a union where most
  members do not declare that property.
- `packages/landing/pages/layout.tsx:3` and adjacent imports lack declarations
  for `*.css?inline`.
- `packages/landing/pages/docs/layout.island.tsx:1` lacks a declaration for a
  side-effect CSS import.

TypeScript 7 compatibility checks found these additional blockers:

- `tsconfig.base.json:11`: `esModuleInterop: false` was removed in TS7.
- `packages/share-kit/tsconfig.json:18`: `baseUrl` was removed in TS7.
- `packages/share-web/tsconfig.json:18`: `baseUrl` was removed in TS7.
- The corresponding `@/*` path targets must become explicitly relative, for
  example `"@/*": ["./src/*"]`.

After overriding the removed `esModuleInterop` setting during the audit,
`core` and `cli` passed TS7. `redact` and `spool-pro-router` passed TS7 without
overrides. The app then reached only its existing `__SPOOL_E2E__` error.

### 2.3 Lint Baseline

The current ESLint configuration contains one intentional rule:
`no-restricted-imports` prevents synchronous `child_process` APIs in the
Electron main process.

`@oxlint/migrate` preserved the complete rule, including `paths`,
`importNames`, custom messages, overrides, and ignore patterns. On this
checkout:

- ESLint and Oxlint reported the same two existing test-only violations.
- ESLint took approximately `10.98 s` in the measured run.
- Oxlint took approximately `1.12 s` in the measured run.
- `oxlint --type-aware` correctly reported every TS7-invalid tsconfig listed
  above.

The two current lint violations are in test files:

- `packages/app/src/main/e2e-mode/e2e-mode-clean.test.ts:24`
- `packages/app/src/main/terminal.test.ts:7`

The production safety rule should remain enabled, but test fixtures that
intentionally invoke a built artifact need an explicit override instead of
leaving the root lint command permanently red.

### 2.4 Search Baseline

The local index used for measurement contained:

- 489 sessions
- 169,261 messages
- approximately 19.4 MB of denormalized `session_search` text

`searchSessionPreview` uses leading-wildcard `LIKE` over full session text in
`packages/core/src/db/queries.ts:529`. It runs immediately on every keystroke
from `packages/app/src/renderer/App.tsx:649`. The regular search runs again
after a 120 ms timer at `packages/app/src/renderer/App.tsx:648`.

Measured preview latency on the local index:

| Query shape | Mean latency |
| --- | ---: |
| one character | 113 ms |
| common word | 145 ms |
| two terms | 431 ms |

The regular search also reached 1.78 seconds for a one-character query. These
queries execute through synchronous `better-sqlite3` handlers in the Electron
main process. Stale-response sequence checks protect rendered state but do not
cancel the database work or prevent event-loop blocking.

### 2.5 Build Baseline

Turbo already understands the workspace dependency graph. Its dry run shows
that `@spool/app#build` depends on `core`, `redact`, and `share-kit`, but the app
build script runs `build:deps` and rebuilds those packages a second time.

Additional gaps:

- Root `build` packages the Electron application instead of separating compile
  and release packaging.
- Turbo declares only `dist/**` as output, while Electron Vite emits `out/**`.
- There is no root `typecheck` or `check` task.
- CI runs package build/test commands serially and omits app, landing,
  share-kit, and router type-check coverage in different paths.
- Native rebuild scripts mutate the shared `better-sqlite3` binary between Node
  and Electron ABIs.

### 2.6 Desktop Package Baseline

The locally built arm64 application is approximately 689 MB:

| Area | Size |
| --- | ---: |
| `Resources/app.asar` | 206 MB |
| `Resources/app.asar.unpacked` | 249 MB |
| Electron frameworks | 232 MB |

Large unpacked modules include:

- `onnxruntime-node`: 88 MB
- `acp-extension-codex-darwin-arm64`: 82 MB
- `better-sqlite3`: 21 MB

Privacy Filter imports `@huggingface/transformers` in the renderer and serves
`onnxruntime-web` assets through a custom protocol. No source import of
`onnxruntime-node` was found. Its removal is promising but must be proven with
a packaged Privacy Filter smoke test.

## 3. PR Plan

### PR 1: Make Type Checking Truthful

Goal: establish a green, complete TypeScript 5.9 baseline before changing the
compiler.

Implementation status: complete on `feat/typecheck-baseline`.

Changes:

1. Add `typecheck` scripts to `@spool/app`, `@spool-lab/core`,
   `@spool-lab/cli`, and `@spool/landing`.
2. Add a root `typecheck` task through Turbo and a root `check` command that
   runs typecheck, lint, and the appropriate unit tests.
3. Declare `__SPOOL_E2E__` in an app-owned `.d.ts` file included by the app
   tsconfig.
4. Add the correct Vite/CSS module declarations for landing imports.
5. Fix the landing `active` union instead of suppressing the error.
6. Make the test-source policy explicit. Production source is checked by
   `tsc`; existing library/app test fixtures that are excluded by package
   tsconfigs continue to be compiled and executed by Vitest. A future
   dedicated test tsconfig should first repair the historical fixture typing
   errors instead of weakening production compiler options.
7. Wire the complete typecheck into pull-request CI.
8. Order package tests after dependency-package tests as an interim guard
   against concurrent app/core rebuilds of the shared `better-sqlite3` binary.
   PR 4 still owns proper ABI isolation.

Verification on 2026-07-11:

- `pnpm typecheck`: 9/9 workspace packages passed.
- `pnpm lint`: passed.
- `pnpm --filter @spool/landing build`: passed using the committed registry
  fallback after the optional registry fetch timed out.
- `pnpm --filter @spool/app build:electron`: passed for main, preload, and
  renderer bundles.
- Core tests passed (404 passed, 1 skipped). A complete local `pnpm test` run
  remains unreliable after desktop native rebuilds because app and CLI tests
  mutate or load different `better-sqlite3` ABIs. On this external-volume
  checkout, Node 24 CLI cold startup also exceeded the suite's 10-second child
  process timeout. PR 4 owns deterministic native isolation; PR 1 does not
  weaken tests or increase their timeouts to mask it.

Acceptance criteria:

- [x] Every workspace package has an explicit typecheck policy.
- [x] `pnpm typecheck` passes with all nine workspace packages in scope.
- [x] App and landing errors listed in section 2.2 are fixed without `any` or
      blanket `skipLibCheck` expansion.
- [x] Pull-request CI runs the root typecheck and lint gates before unit tests.

### PR 2: Replace ESLint with Oxlint

Goal: remove the unsupported TypeScript parser dependency before adopting TS7
and preserve the existing Electron main-thread safety rule.

Implementation status: complete on `feat/oxlint-migration`.

Implementation notes:

1. Pin `oxlint@1.73.0` and use it for the root `lint` command.
2. Commit the reviewed migration output in `.oxlintrc.json`, preserving every
   ignore pattern, restricted module, import name, and custom diagnostic.
3. Replace the unsupported nested test ignore with an exact final override for
   the two intentional test fixtures.
4. Remove ESLint, `@typescript-eslint/parser`, and `eslint.config.mjs`.
5. Keep syntax-aware linting for this PR; type-aware linting remains owned by
   PR 3 after the TS7-invalid tsconfigs are repaired.

Verification on 2026-07-12:

- `pnpm install --frozen-lockfile`: passed; ESLint and the TypeScript ESLint
  parser are absent from the direct installation.
- `pnpm typecheck`: passed for all workspace packages.
- `pnpm lint`: passed.
- A temporary prohibited production import failed with the preserved custom
  diagnostic; both exact test fixtures passed lint.
- Isolated CLI tests passed (53/53), and `sp status` loaded the local index.
- Root `pnpm test` reproduced the already documented shared native rebuild
  race: app rebuilt `better-sqlite3` while CLI tests were loading it. PR 4 owns
  that isolation; the Node ABI was restored before the isolated CLI rerun.

Changes:

1. Add pinned dev dependencies for `oxlint@1.73.0`. Add
   `oxlint-tsgolint@0.24.0` when the type-aware command is enabled.
2. Generate the initial config with `@oxlint/migrate`, then commit a reviewed
   repository config rather than invoking the migrator in CI.
3. Preserve all existing ignore patterns and the scoped
   `no-restricted-imports` rule for:
   - `node:child_process`
   - `child_process`
   - `execSync`, `spawnSync`, and `execFileSync`
4. Add a test-file override for the two intentional test-only imports. Keep
   the restriction active for production main-process code.
5. Replace the root `lint` script with Oxlint and remove ESLint plus
   `@typescript-eslint/parser` only after parity is demonstrated.
6. Start with syntax-aware linting. Enable type-aware rules in PR 3 after all
   tsconfigs are valid under TS7.

Acceptance criteria:

- [x] Oxlint catches a temporary prohibited import in production main code.
- [x] Oxlint allows the documented test fixtures only.
- [x] `pnpm lint` is green on the repository baseline.
- [x] ESLint and `@typescript-eslint/parser` are no longer installed.
- [x] The custom diagnostic message is preserved.

### PR 3: Migrate to TypeScript 7 and Enable Type-Aware Linting

Goal: switch build and typecheck commands to native `typescript@7.0.2`.

Implementation status: complete on `feat/typescript-7`; cross-platform CI and
the full local E2E duration gate remain external verification.

Implementation notes:

1. Pin `typescript@7.0.2` once at the workspace root and remove four
   package-local TypeScript ranges.
2. Remove the TS7-invalid `esModuleInterop: false` and `baseUrl` options and
   make both `@/*` substitutions explicitly relative.
3. Add `oxlint-tsgolint@0.24.0`, run Oxlint with `--type-aware`, and enable
   `typescript/no-floating-promises` with `ignoreVoid: true`.
4. Review all 22 initial promise findings. Mark deliberate background work,
   handle clipboard/worker/search rejection paths, and preserve existing UI
   behavior.
5. Keep share-kit declarations under TS7 with `vite-plugin-dts@5`, its
   documented `@typescript/typescript6` compiler-API fallback, and no declaration
   bundling. TypeScript 7 no longer exposes the JavaScript compiler API and API
   Extractor still embeds TypeScript 5.9; entrypoint declarations and the full
   internal declaration tree remain emitted.

Verification on 2026-07-12:

- `pnpm exec tsc --version`: `7.0.2`.
- `pnpm typecheck`: all nine workspace packages passed.
- `pnpm lint`: passed with type-aware linting and no tsconfig diagnostics.
- Core, CLI, redact, share-kit, share-web, landing, and Electron bundle builds
  passed under the centralized TS7 install.
- Sequential unit assertions passed: redact 135, share-backend 247, share-kit
  68, share-web 84, core 404 with 1 skipped, app 482, and CLI 53. Under the
  current host load the CLI runner later emitted a Vitest worker RPC timeout
  after all 53 assertions had passed.
- Electron E2E built and launched successfully. It completed 65 tests with no
  final assertion failures before the suite's 300-second host timeout; three
  first-attempt failures passed on retry, cleanup timed out, one test was
  skipped, and 100 tests did not run. Full macOS/Linux CI remains required.
- The final Node ABI rebuild completed and `sp status` loaded the local index.

Changes:

1. Pin a single TypeScript version at the workspace root. Remove duplicated
   package-local ranges or centralize them with a pnpm catalog.
2. Remove `esModuleInterop: false` from `tsconfig.base.json`.
3. Remove `baseUrl` from share-kit and share-web.
4. Change path targets to explicit relative paths such as
   `"@/*": ["./src/*"]` and verify matching Vite aliases.
5. Run all package build and typecheck commands using TS7.
6. Enable `oxlint --type-aware` and add a conservative initial rule set.
7. Introduce `typescript/no-floating-promises` with
   `{ "ignoreVoid": true }`. Fix findings explicitly; do not mass-prefix
   unknown promises with `void` without checking intent.
8. Keep Node 22 CI and document the minimum supported Node runtime before
   raising emitted JavaScript targets.

Acceptance criteria:

- [x] `pnpm exec tsc --version` reports `7.0.2`.
- [x] All package typechecks and builds pass under TS7.
- [x] `oxlint --type-aware` reports no tsconfig errors.
- [ ] Unit and E2E suites pass on Linux and macOS.
- [x] CLI startup and the Electron E2E app both load `better-sqlite3`.

### PR 4: Separate Build, Package, and Native ABI Tasks

Goal: remove duplicate work and make build outputs cacheable and deterministic.

Implementation status: complete on `feat/build-native-isolation`; signed release
artifacts remain CI-only verification.

Implementation notes:

1. Make the app's Turbo `build` task bundle-only and let `^build` own core,
   redact, and share-kit ordering. A package-local Turbo config records
   `out/**` instead of the generic `dist/**` output.
2. Split bundle and release packaging into `build`, `package`, `package:mac`,
   and `package:linux`. Release workflows now call those public tasks.
3. Pin the app, core, and CLI test fixture to one `better-sqlite3@11.10.0`.
   The landing toolchain's unrelated optional 12.x instance remains outside
   the Spool database path.
4. Rebuild the Node ABI once before the root test graph. Remove package-local
   rebuilds so app, core, and CLI tests cannot mutate the native binary while
   another test is loading it.
5. Serialize the root test graph on constrained hosts and run CLI test files in
   one worker. Turbo still provides dependency ordering and result caching.
6. Wrap Electron dev, E2E, and packaging commands with an Electron rebuild and
   unconditional Node ABI restoration. Disable electron-builder's second
   implicit rebuild and add a reusable Electron native smoke command.

Verification on 2026-07-12:

- First `pnpm build`: seven tasks passed; app dependencies each built once.
- Second unchanged `pnpm build`: 7/7 full Turbo cache hits in 92 ms.
- Root build invoked no DMG, ZIP, AppImage, or electron-builder task.
- `pnpm --filter @spool/app smoke:native:electron` loaded SQLite inside
  Electron, restored the Node ABI, and the subsequent `sp status` succeeded.
- After removing concurrent native rebuilds, root tests no longer produced a
  missing-binding or ABI mismatch. On this host, core passed 404 tests with one
  skipped and CLI passed all 53 assertions in isolated runs; a later root run
  still hit existing 5-second CLI timeouts under sustained system load.
- Release signing, notarization, and Linux packaging remain covered by the
  unchanged electron-builder configuration and require CI credentials.

Changes:

1. Let Turbo own workspace dependency ordering. Remove manual dependency
   rebuilds from the app task when it is invoked through Turbo.
2. Split app commands into distinct responsibilities:
   - dependency/library build
   - Electron Vite bundle
   - macOS package
   - Linux package
3. Make root `build` compile/bundle only. Release workflows should invoke an
   explicit package task.
4. Add task-specific Turbo outputs, including app `out/**` for bundling and
   `dist/**` for packaging.
5. Add `typecheck` and `check` tasks to `turbo.json`.
6. Replace the serial unit workflow with the root check graph where native ABI
   operations cannot race.
7. Isolate Node and Electron native rebuilds, or produce separate copied
   artifacts, so running desktop tests cannot silently break the globally
   linked CLI.

Acceptance criteria:

- [x] A Turbo build does not build core/redact/share-kit twice.
- [x] A second unchanged build is a cache hit for all compile/bundle tasks.
- [x] Root build does not create DMG, ZIP, or AppImage artifacts.
- [ ] Release packaging remains signed/notarized exactly as before.
- [x] Running the Electron native smoke followed by `sp status` succeeds without a manual ABI
      repair.

### PR 5: Remove Search Work from the Electron Main-Thread Hot Path

Goal: keep typing responsive as the local index grows.

Implementation status: complete on `feat/search-hot-path`; packaged-app input
responsiveness remains part of the final desktop smoke pass.

Implementation notes:

1. Add an audit-sized benchmark command backed by the production-equivalent
   session and message FTS schema. The command records mean, p95, and maximum
   synchronous blocking time and fails above the 50 ms p95 or 100 ms blocking
   budgets.
2. Ignore one-code-point ascii preview queries. Single CJK characters are
   meaningful queries and keep the pre-existing LIKE path.
3. Build prefix FTS queries for Unicode text and trigram queries for CJK. Use
   AND terms for session candidates and OR terms for message candidates so the
   best snippet can still be selected when terms occur in different messages.
4. Preserve title weighting, term coverage, user-message preference, source,
   date, project identity, and pin filters. Plans whose terms cannot match
   their FTS table — any sub-trigram term when the query contains CJK, or a
   punctuation-only term under unicode61 — retain the existing LIKE fallback,
   so queries like `错误码 42` and `foo =>` keep returning results.
5. Keep search in the main process for now. Measured maximum synchronous work
   is below 10 ms on the real 393.6 MB index and below 2 ms on both synthetic
   fixtures, so a worker thread would add lifecycle and consistency complexity
   without addressing a measured budget breach.

Verification on 2026-07-12:

- 500 sessions / 170k messages: `search` p95 0.76 ms and `search latency`
  p95 1.22 ms.
- 750 sessions / 255k messages: p95 1.13 ms and 1.08 ms respectively; maximum
  synchronous search time was 1.24 ms.
- Real 393.6 MB local index with 489 sessions: `search` p95 6.75 ms and
  `typescript migration` p95 7.94 ms; maximum was 9.99 ms.
- Core passed 410 tests with one skipped, including search ordering, source,
  date, project identity, pins, snippets, highlighting, and newly indexed
  session visibility.
- App typecheck and repository type-aware lint passed. The renderer is
  untouched by this PR — the live typing path (CommandPalette) already issues
  a single preview request per input change.

Current complexity:

- Preview search performs leading-wildcard scans over denormalized full-session
  text: approximately `O(session count * indexed text * query terms)` per
  keystroke.
- The UI issues immediate preview work and a second regular search shortly
  afterward.

Implementation order:

1. Add a reproducible benchmark fixture near the current 500-session /
   170k-message scale and a larger synthetic scale.
2. Debounce preview requests and define behavior for one-character queries.
3. Avoid issuing preview and full search for the same input unless both results
   are visibly required.
4. Route preview through FTS5/trigram search instead of `%LIKE%` over full
   session text. Preserve title weighting and snippet quality.
5. If synchronous DB work can still exceed the latency budget, move search to
   a dedicated worker thread with its own read connection. Sequence IDs alone
   are not cancellation.
6. Verify search cache invalidation while sync/indexing is active.

Target complexity:

- Indexed retrieval should be driven by FTS index lookup plus result ranking,
  approximately proportional to matching postings rather than all session
  text.

Acceptance criteria:

- [x] Preview p95 is below 50 ms on the audit-sized fixture.
- [x] No one-character query blocks the Electron main process for hundreds of
      milliseconds.
- [x] Search ordering, source filters, project scope, pins, snippets, and
      highlighting retain regression coverage.
- [x] Synchronous blocking measurements show no search-induced beachball
      threshold breach.

### PR 6: Reduce Desktop Package Size

Goal: remove demonstrably unused runtime payload without weakening Privacy
Filter, ACP, or native database behavior.

Changes:

1. Add a package-size report that records asar, unpacked resources, frameworks,
   and the largest modules.
2. Prove whether `onnxruntime-node` is unused in packaged production paths.
3. Exclude it from Electron packaging only after the packaged Privacy Filter
   flow passes.
4. Investigate copying only required `onnxruntime-web` runtime assets into app
   resources instead of packaging its full dependency tree and a duplicate
   emitted WASM asset.
5. Keep the platform ACP extension and `better-sqlite3`; they are expected
   runtime payloads.

Acceptance criteria:

- [ ] Packaged app starts on a clean macOS user profile.
- [ ] Search and indexing work with the packaged native SQLite module.
- [ ] Codex and Claude ACP launch paths work.
- [ ] Privacy Filter downloads, initializes, scans, and purges locally.
- [ ] The app bundle shrinks by at least the proven unused payload; expected
      first target is approximately 80 MB from `onnxruntime-node`.

### PR 7: Dependency and Module Maintenance

Goal: make future upgrades smaller and safer.

Changes:

1. Add automated dependency update PRs grouped by risk:
   - patch/minor tooling
   - Electron and native modules
   - ACP extensions
   - renderer/framework majors
2. Upgrade Electron independently from TypeScript. The audited gap was
   `34.5.8` to `43.1.0`, which requires staged release and E2E validation.
3. Do not batch Shiki, Void, i18next, Electron, and ACP major upgrades into one
   PR.
4. Split oversized orchestration modules only when a functional change touches
   them. Current high-churn candidates include:
   - `packages/app/src/renderer/App.tsx`
   - `packages/app/src/renderer/components/SecurityPage.tsx`
   - `packages/app/src/renderer/components/ShareEditorPage.tsx`
   - `packages/app/src/main/index.ts`
   - `packages/core/src/db/queries.ts`
5. Use React profiling before adding memoization. File size alone is not proof
   of a render bottleneck.

## 4. Required Verification Matrix

Every PR must run the narrow checks for its changed surface. Before merging a
phase, run the complete matrix:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @spool/app test:e2e
pnpm --filter @spool-lab/cli build
sp status
```

For desktop packaging changes also run:

```bash
pnpm run rebuild:native:electron
pnpm --filter @spool/app build:electron
pnpm --filter @spool/app exec electron-builder --mac --arm64 --dir
codesign --verify --deep --strict --verbose=2 \
  packages/app/dist/mac-arm64/Spool.app
pnpm run rebuild:native:node
sp status
```

The final Node ABI rebuild is mandatory while the workspace still shares one
mutable `better-sqlite3` artifact.

## 5. Constraints

- Preserve local-first behavior and the current telemetry/privacy guarantees.
- Do not introduce a remote search, analytics, or model inference dependency.
- Do not weaken the Electron main-thread synchronous-process restriction.
- Do not hide TS7 errors with `ignoreDeprecations`, broad `any`, or blanket
  excludes.
- Do not optimize search ordering without golden-result regression tests.
- Do not remove packaged native/model assets based only on import search;
  verify the packaged application.
- Keep each PR reviewable and leave unrelated visual/UI changes out of this
  roadmap.

## 6. Recommended Execution Order

1. PR 1: truthful typecheck baseline
2. PR 2: Oxlint parity and ESLint removal
3. PR 3: TypeScript 7 plus type-aware linting
4. PR 4: build/package/native ABI separation
5. PR 5: search hot-path optimization
6. PR 6: package-size reduction
7. PR 7: staged dependency maintenance

PRs 5 and 6 may proceed in parallel after PR 4. PR 3 must not begin before the
typecheck baseline is green, and the root TypeScript dependency must not move
to 7 while `@typescript-eslint/parser` is still the active linter parser.
