# Engineering Optimization Stack — July 2026

> Historical record. Shipped as PRs #412–#418 (with #411 alongside),
> 2026-07-13 → 2026-07-16. The full plan, per-PR rationale, and
> verification notes live in the PR descriptions; the ongoing verification
> checklist moved to CONTRIBUTING.md ("Verifying changes"). Baseline
> numbers referenced below were measured against `main@049c4b2`
> (2026-07-11) and are not maintained.

## What shipped

| PR | Change |
|----|--------|
| [#412](https://github.com/spool-lab/spool/pull/412) | Typecheck across all 9 workspace packages; root `typecheck`/`check` tasks wired into PR CI |
| [#413](https://github.com/spool-lab/spool/pull/413) | ESLint → oxlint with exact rule parity (main-process sync `child_process` ban preserved) |
| [#414](https://github.com/spool-lab/spool/pull/414) | TypeScript 7 (native compiler) + type-aware lint; typechecks ~7.5× faster |
| [#415](https://github.com/spool-lab/spool/pull/415) | Build/package/native-ABI split: `pnpm build` only compiles, `package:*` wraps electron-builder in an ABI flip/restore, app builds are turbo-cached |
| [#416](https://github.com/spool-lab/spool/pull/416) | Preview search on FTS5 prefix/trigram indexes (single-digit-ms p95 on a 393 MB index, from 100–400 ms LIKE scans), with a LIKE fallback for FTS-unmatchable shapes |
| [#417](https://github.com/spool-lab/spool/pull/417) | −87 MB macOS package (`onnxruntime-node` proven unused via packaged smoke); purge also masks stored titles and rebuilds session FTS; PF inference gets a dedicated offline CSP |
| [#418](https://github.com/spool-lab/spool/pull/418) | Dependabot risk-lane grouping; find-in-session debounced with stale-visible semantics |

## Decisions of record

- **Search stays in the Electron main process.** After #416 the measured
  synchronous maximum was under 10 ms on a real 393 MB index (p95 ≈ 7 ms).
  A worker thread would add lifecycle and consistency complexity without a
  measured budget breach — revisit only against new measurements.
- **Packaged assets are removed only with packaged-app proof.** Import
  search misses dynamic loading; #417 shipped with an asar size report and
  a packaged smoke test (`packages/app/scripts/smoke-packaged.mjs`).
- **One `better-sqlite3` ABI at a time.** The workspace pins one version
  and flips it Node↔Electron via `scripts/with-electron-native.mjs`,
  restoring Node afterwards. See CONTRIBUTING "Native module runtimes".
- **Preview FTS plans fall back to LIKE rather than under-match.** Any
  plan term that cannot match its FTS table (sub-trigram terms when the
  query contains CJK, punctuation-only terms under unicode61) routes the
  whole query to the LIKE scan, so `错误码 42` and `foo =>` keep working.

## Known follow-ups

Tracked in the PR descriptions: #415 — Ctrl-C skips the wrapper's ABI
restore; unconditional `pretest` rebuild costs ~1 min per run. #416 —
diacritic-folded FTS hits can render an unhighlighted snippet. #417 —
truncated-title mask residue; a re-mask migration for pre-#417 purges;
bulk-purge throughput at #344 scale.
