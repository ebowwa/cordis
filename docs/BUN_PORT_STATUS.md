# Cordis Bun Port — Status Log

Session log of completed work, exact commands, current failures, next action,
and commit SHAs. Update before ending or compacting any work session.

## Environment (recorded once, 2026-08-16)

- Fork HEAD at audit start: `8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4`
- `upstream` = `cordiverse/cordis`, fetched; `origin` = `ebowwa/cordis`
- Working branch: `feat/bun-compat` (created from `main` == `upstream/main`)
- Node `v26.4.0`, npm `11.17.0`
- Yarn: pinned `4.14.1` unavailable on this registry (max `2.4.3`); no
  corepack in Node 26.4.0 → dependencies installed with Bun; yakumo/vitest
  invoked directly with the same flags `package.json` scripts use
- **Bun pinned for this port: `1.3.14` (revision `1.3.14+0d9b296af`)**

## Completed

### Phase 0 — read-only audit (DONE) — commit `06ae971`

### Phases 1–3 — Bun behavioral suite (DONE, 57/57) — commit `06ae971`

### Phase 4 — CLI, scripts, CI, compatibility docs (DONE)

- `packages/core/bin.bun.js` — Bun entrypoint (same behavior as `bin.js` +
  graceful SIGINT/SIGTERM root disposal). Verified manually: loads
  `cordis.yml`, writes back config, exits 0.
- `packages/core/bin.bun.watch.js` — development supervisor (see Phase 5A).
- Root `package.json` scripts (additive): `test:bun`, `start:bun`, `dev:bun`.
- `.github/workflows/bun.yml` — Bun 1.3.14 job: bun install → node+yakumo
  build → `bun test tests/bun` → Node suite. Upstream `build.yml` untouched.
- `docs/BUN_COMPATIBILITY.md` — package-by-package matrix, verified
  commands, reload decision, Cordis-vs-Bun change list.

### Phase 5A — `--watch` progression, evaluated and delivered (DONE)

Empirical findings on Bun 1.3.14 (standalone repros; **semantics corrected
2026-08-16** — the original notes misattributed `--watch` as an in-process
re-evaluation; per Bun's docs and re-measurement `--watch` is a hard restart
and `--hot` is the in-process soft reload):

- `bun --watch` **restarts the runtime**: `globalThis` is fresh per reload
  (generation counter resets), module registry cleared, timers removed
  *without* running Cordis disposers; signal handlers do NOT accumulate
  (one handler fires once after three reloads). No public before-reload
  hook → graceful Cordis disposal impossible from inside the reloaded
  module.
- `bun --hot`: `globalThis` survives (counter increments), previous
  generations' timers/listeners keep running (one signal fired three
  handlers after three reloads) → Cordis state duplicates; and on 1.3.14
  `import.meta.hot` is `undefined` in both modes, so no cleanup hook.

Delivered: supervisor `packages/core/bin.bun.watch.js` (public APIs only:
`node:fs.watch`, `node:child_process`) — on change: SIGTERM child → child
performs complete root-fiber disposal → exit 0 → respawn. Dispose-before-
activate ordering asserted by `tests/bun/watch.spec.ts`.

Phase 5B verdict (1.3.14): `--hot` unsuitable on stock Bun (no
`import.meta.hot`, duplication). Phase 5C (selective HMR): deferred —
optional per success criteria; adapter design sketch recorded in
BUN_COMPATIBILITY.md.

### Phase 7 — upstream integration with oven-sh/bun#32856 (DONE)

Focused downstream-integration project (owner-directed; no Bun fork):

- Installed the PR build without building Bun: `bunx bun-pr 32856` →
  `~/.bun/bin/bun-fe4557d630980a13ae56fb04d8660732d7c30439-pr32856`
  (reports `1.4.0`; artifact from the Aug 13 CI run).
- Verified the PR's claims against Cordis use cases with standalone probes:
  `import.meta.hot` is an object under `--hot`; `hot.data` persists across
  reloads; dispose callbacks for the entry AND dynamically imported modules
  run, awaited, strictly before re-evaluation; editing a dynamically
  imported plugin triggers reload of the whole reachable graph.
- `packages/core/bin.bun.js` now registers
  `import.meta.hot.dispose(() => disposePrevious())` when the runtime
  provides `import.meta.hot` (no-op on stock Bun/Node where it is
  `undefined`): runtime-driven awaited disposal before re-evaluation,
  stronger than the module-top `globalThis` guard, which remains as
  defense-in-depth.
- `tests/bun/hot.spec.ts` (3 tests, PR-build-gated, skip cleanly when the
  binary is absent): (a) async disposer (150 ms) completes before the next
  generation activates, timers never duplicate across 3 generations, clean
  SIGINT; (b) broken generation: old root still disposed first, no leaked
  ticks, recovery on next valid edit, exit 0; (c) **removed module**: when
  gen 2 drops a helper import, the helper's `import.meta.hot.dispose` AND
  the Cordis root-fiber disposal complete strictly before gen 2 activates,
  and the helper's timer never fires again (the PR's removed-modules claim).
- Also verified on the PR build: editing `cordis.yml` triggers NO reload
  (config files are outside the module graph) — documented as a `--hot`
  limitation; the supervisor's `fs.watch` does catch config edits.
- Results: `bun test tests/bun` 61/61 (58 prior + 3 new; with the PR binary
  absent the 3 new tests skip — verified via `HOME=/tmp/... bun test`);
  Node suite 19 files / 163 tests unchanged. No Bun-source changes were
  needed → **no defect report required**; nothing failed against the PR
  build.
- Downstream-validation comment posted on the PR (owner-approved):
  <https://github.com/oven-sh/bun/pull/32856#issuecomment-5313256957> —
  the six verified cases + the non-module-file note. This is the extent of
  upstream activity: a comment, not code.

### Phase 9 — upstream code contribution to oven-sh/bun (DONE)

Owner then elected full Bun-contributor work (Bun-only, decoupled from
Cordis). Recon over the HMR/module-reload area surfaced
[oven-sh/bun#21346](https://github.com/oven-sh/bun/issues/21346):
`import()` of a `file://` URL with distinct query strings returns the SAME
cached module instance (relative specifiers with queries work correctly).
Confirmed by standalone repro on Node v26.4.0 (3/3 distinct) vs Bun 1.3.14
and the bun#32856 PR build (1/3 — cached). This is also the exact
public-API primitive Cordis's deferred Phase C selective-HMR adapter
depends on.

Root cause: the module loader decoded `file://` specifiers to a path via
`WTF::URL::fileSystemPath()` (pathname only — query dropped) before
building the module key, in `moduleLoaderResolve` (static imports),
`moduleLoaderImportModule` (dynamic imports), and Rust
`do_resolve_with_args` (`Bun.resolveSync` / `import.meta.resolve`).

Delivered (in `.upstream/bun`, locally excluded; fork `ebowwa/bun`):
- Fix at all three sites, mirroring the query-preservation pattern the
  same code already used for referrers. `URL__pathFromFileURL` untouched
  (path API; stripping is correct there).
- 3 tests added to the existing `test/js/bun/resolve/import-query.test.ts`
  (dynamic/static `file://`+query distinct instances; `Bun.resolveSync`
  keeps the query).
- Verification per repo rules: new tests fail under `USE_SYSTEM_BUN=1`;
  18/18 pass via `bun bd test`; full `test/js/bun/resolve/` failure set
  identical to unmodified-main baseline (6 pre-existing debug-build
  timeouts) — zero regressions.
- Toolchain note: llvm@21/cmake/ninja/rust installed; first debug build
  ≈40 min on this machine; PR branch prefix `claude/` is a repo CI
  requirement.
- **Open as [oven-sh/bun#39426](https://github.com/oven-sh/bun/pull/39426)**
  (owner-approved), Fixes #21346.
- Post-open review follow-up (`c16333e9`): CodeRabbit flagged missing
  `import.meta.resolve` coverage. Investigation showed
  `import.meta.resolve` handles `file://` via URL joining (never hits the
  changed code — already correct; guard test added), while
  `import.meta.resolveSync` routes through `Bun__resolveSync` and HAD the
  same dropped query — now covered and fixed by the same change.
  20/20 in the file; reply posted on the PR.
- CI state (2026-08-17 ~16:00Z): build 99960 (first commit) ran ~6h then
  was auto-superseded (`cancel_reason: build_skipping`) when build 100030
  dispatched for `c16333e9`. Build 100030 is **`blocked`** — Buildkite's
  approval gate for fork/first-time contributors; a maintainer must
  approve CI to run. No test failures anywhere; GitHub statuses remain
  "pending" until the gate clears. Monitoring signal: the PR's
  buildkite/bun badge, or `builds/100030.json` (public, unauthenticated).
- Downstream-usage comment posted on the PR (owner-approved, 2026-08-17):
  <https://github.com/oven-sh/bun/pull/39426#issuecomment-5317949426> —
  the selective-plugin-reload use case the fix unlocks (Cordis PR #2's
  spec linked), the two-public-call primitive, and full-suite green on
  the debug build.
- Cordis PR #2 opened stacking on PR #1:
  `feat/bun-selective-reload` → `feat/bun-compat`, 1 commit, +311/−9 —
  the Phase C selective-reload spec + driver + repro + docs. CI green
  (65 pass + 4 skip on stock Bun 1.3.14; the new test is
  capability-gated and skips there, activating when a shipped Bun
  includes #39426).
- Prior-art sweep (owner-requested, 2026-08-17 ~19:30Z) found **#35601** —
  robobun's earlier PR (Jul 25) fixing the SAME bug: identical root-cause
  diagnosis, same three sites, PLUS BunPlugin.cpp / mock.module via a
  shared `fileSystemPathWithQuery` helper, and it also fixes #13391
  (`bunx --bun astro dev` stale config). It is stalled/dirty (untouched
  since Jul 26, merge conflicts vs main, mixed CI). **Our #39426 is a
  partial duplicate, opened unknowingly** — the original recon searched
  issues (found #21346) but never `is:pr 21346` for prior PRs. Lesson
  recorded: run the 5-second prior-PR search before opening any fix.
  Disclosed on both (owner-approved): [#39426
  comment](https://github.com/oven-sh/bun/pull/39426#issuecomment-5318372531)
  (offering to close as superseded if they revive theirs) and [#35601
  comment](https://github.com/oven-sh/bun/pull/35601#issuecomment-5318379869)
  (downstream validation + test-matrix offer, to help un-stall the better
  PR). Cordis PR #2 is unaffected: its gating is capability-based and
  activates on whichever PR lands.
- CodeRabbit review loop closed (2026-08-17): its single actionable
  finding (add `import.meta.resolve` coverage) was addressed by
  `c16333e9`; a threaded reply on the finding
  (`discussion_r3797402606`) got the bot's acknowledgment ("the added
  coverage is sufficient — ✅ Review thread resolved", plus a recorded
  repo learning on URL-join vs `Bun__resolveSync` routing). Note:
  CodeRabbit **auto-updates on every push** by editing its walkthrough
  comment in place (not via new review records) — its 17:06 auto-update
  delta-reviewed `4fde4e56 → c16333e9` with **zero actionable
  comments** and raised Merge Risk 🔵 Low → **⚪ Minimal**; the manual
  `@coderabbitai review` trigger was redundant (that command is only
  for paused auto-reviews). **Zero open bot findings**; `claude[bot]`
  review stays disabled for fork PRs until a maintainer invokes it.
  Remaining gate: Buildkite approval (build 100030 still `blocked`).

### Full-suite phase boundary results

```
bun test tests/bun                  # 68 pass / 0 fail / 248 expect() calls
                                     # (58 core + 7 browser-export + 3 PR-gated)
node ... yakumo vitest --import tsx # 19 files / 163 tests passed (see run log)
```

### Phase 6 — benchmark & profile comparison vs the original (DONE)

Motivation: owner asked whether we had profiled/benchmarked against the
original. Answer had been no (behavioral verification only); this phase adds
`bench/` + `docs/BUN_BENCH.md`.

What was measured (2 full passes each; ranges in the doc):

- **Control — fork vs upstream** (`cordiverse/cordis@8cc9e33` in a git
  worktree, built + run identically under Node): statistically
  indistinguishable; alternating A/B on the noisiest workload showed
  overlapping ranges (fork 735–849 vs upstream 690–741 µs/op). Expected:
  zero runtime-source changes.
- **Node vs Bun (fork)**: Bun faster on every Cordis operation —
  context/plugin/effects machinery ~5x, timers ~3x, loader tree updates
  ~2.4x, Include boot ~4x, fresh TS module eval ~80x (tsx RPC vs native
  transpile). Timer-settle-dominated workloads (async effects, inject
  cycles) are runtime-neutral (macOS `setTimeout(0)` floor).
- **Cold start**: Cordis core boot ≈23 ms on Node vs ≈22 ms on Bun (parity);
  Node's TS penalty (~400 ms) is entirely the tsx toolchain.
- **Memory**: 600 load/dispose cycles — registry empty, no leftover
  listeners/timers on either runtime (heap growth: node +5.2 MB, bun
  +0.3 MB; rss accounting differs between V8/JSC).
- **CPU profiles** (`--cpu-prof` both runtimes): top Cordis-internal
  hotspot is `packages/core/src/reflect.ts` proxy machinery on BOTH
  runtimes — shared optimization target, not a Bun issue.

Cordis change required by benching (additive): root `package.json` gained
`cordis`, `@cordisjs/plugin-loader`, `@cordisjs/plugin-timer` in
`devDependencies` so root-level bench files resolve workspace packages
under Bun's isolated linker (under Yarn hoisting this is a no-op).

Reproduce: see the command block at the top of `docs/BUN_BENCH.md`.

## CI incident & fix (post-PR #1)

PR #1 CI failed on both the `build` (yarn) job and the Bun job:
`yakumo-tsc` aborted with **"circular dependency detected"** — the
`@cordisjs/plugin-include` devDependency I had added to
`packages/loader/package.json` introduced a
`plugin-loader → plugin-include → plugin-loader` cycle in yakumo's build
graph (include peer-depends on loader). Process miss: after that edit I
re-ran the test suites but not the yakumo build.

Fix: `packages/loader/package.json` reverted to **upstream-identical**; the
dependency moved to the **root** `package.json` devDependencies (module
resolution from `packages/loader` walks up to root `node_modules`; the root
is outside yakumo's package graph, so no cycle). Re-verified locally in
order: yakumo esbuild (exit 0), yakumo tsc (exit 0), `bun test tests/bun`
58/58, Node suite 163/163.

Lesson recorded: **run the full build, not only the suites, after any
dependency-graph change.**

### Phase 8 — logger-console browser export under Bun (DONE)

Owner-selected follow-up (upgrades a 🟡 matrix cell to ✅):

- `tests/bun/logger-console-browser.spec.ts` (7 tests): loads
  `lib/browser.js` by path (the export map's `default`-condition file —
  under Bun the bare specifier correctly picks the `node` condition),
  wires it via `ctx.plugin`, and verifies: error/warn/log method routing
  with `[T] name` prefix; argument pass-through **by identity**; log
  levels; operation with `document`/`window` hard-absent; plus declarative
  checks — export map routes non-node consumers to `browser.js`, shipped
  artifact has zero `node:` specifiers. The browser build's only
  environment requirement is a `console`.
- Near-miss recorded (NOT a Bun defect): bundling bare `@cordisjs/*`
  imports from inside this repo resolves via root `tsconfig.json` `paths`
  → `packages/*/src`, bypassing export maps — `Bun.build` and esbuild both
  pick the node source regardless of `target: 'browser'`. Verified with a
  standalone probe against both tools before discarding the "Bun ignores
  browser target" hypothesis. Documented under "Known behavior nuances".
  (Bun's `--conditions` is additive and cannot remove the `node`
  condition.)
- Results: `bun test tests/bun` 68/68 (61 + 7 new, all stock-Bun).

### Phase 10 — Phase C selective HMR unblocked by our own PR (DONE)

Owner asked "can we use it with our cordis?" — answered at three levels:

1. **Drop-in compatibility**: the full Cordis suite runs green on the
   bun#39426 debug build — 68/68 (all stock tests, incl. the 3 #32856-gated
   ones skipped for lack of that binary's alias).
2. **The previously-impossible use case**: selective plugin reload now
   works in-process on public APIs — `import(fileURL + "?gen=N")` for a
   fresh instance + `root.plugin(mod)` + `previousFiber.dispose()` for a
   graceful swap. Verified by transcript: fresh instance per generation,
   old fiber disposed only after the new applies, root effects survive
   unduplicated, single disposal at shutdown.
3. **Locked in**: `tests/bun/selective-reload.spec.ts` +
   `fixtures/selective-reload-driver.ts`, capability-gated (probes the
   runner for query-busting; stock Bun → clean skip). 69/69 with the
   capable build present. Manual narrative: `repros/selective-reload.ts`.

Still deferred for a production selective-HMR service: fs watching →
generations, config preservation, rollback. The module-swap primitive is
done.

## Current failures

None.

## Next action

- Push branch / open PR is owner-gated (explicit approval required).
- When oven-sh/bun#32856 merges and ships in a release, drop the
  PR-binary gating in `tests/bun/hot.spec.ts` and re-pin the CI Bun version;
  the supervisor stays as the `--watch`-equivalent for hard restarts.
- Optional future work: Phase C selective HMR adapter if whole-process
  reload proves inadequate; browser export of logger-console under Bun;
  `create-cordis` runtime verification.

## Commit SHAs

- `06ae971` — Phase 0–3: Bun behavioral suite + plan/status docs + loader
  devDependency fix
- `a8499bd` — Phase 4–5: entrypoints, supervisor, CI, compatibility docs
- `e3cc3f9` — docs: phase 4–5 status recording
- `f98c663` — Phase 6: benchmarks, memory/CPU profiles, fork-vs-upstream
  control comparison (docs/BUN_BENCH.md)
- `10b2df7` — fix(ci): move plugin-include devDependency to root (post-PR #1)
- `fdfe2e9` — Phase 7: oven-sh/bun#32856 integration (hot.spec.ts,
  bin.bun.js import.meta.hot.dispose, corrected --watch/--hot docs, CI
  best-effort PR install, repros)
- `a46f378` — docs: phase 7 commit SHA record
- `c678d87` — docs: finish --watch/--hot correction (bin.bun.watch.js
  header, watch-timer-disposers.ts SIGINT comment); hot.spec stability
  confirmed over 3 runs
- `770134d` — test: third PR-gated hot test (removed-module disposal) +
  documented cordis.yml-edit gap; 61/61
- `39bac40` — docs: record 770134d SHA
- `2c07253` — docs: record downstream-validation comment on oven-sh/bun#32856
- `565fa27` — Phase 8: logger-console browser-export verification
  (logger-console-browser.spec.ts, 7 tests) + tsconfig-paths bundling
  nuance; 68/68

Branch: `feat/bun-compat`, pushed; open as ebowwa/cordis#1 (mergeable,
CI green incl. bun#32856 integration suite).
