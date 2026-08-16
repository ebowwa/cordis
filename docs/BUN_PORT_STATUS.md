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

Empirical findings on Bun 1.3.14 (standalone repros in the doc):

- `bun --watch` re-evaluates the entry in-process (same pid); `globalThis`
  and `process` are FRESH per reload → new evaluation cannot reach the old
  Cordis root; timers are cleared by Bun without running disposers; old
  signal handlers accumulate; no public before-reload hook.
- `bun --hot`: previous generations' timers/listeners keep running →
  Cordis state duplicates across reloads (confirmed by interleaved output).

Delivered: supervisor `packages/core/bin.bun.watch.js` (public APIs only:
`node:fs.watch`, `node:child_process`) — on change: SIGTERM child → child
performs complete root-fiber disposal → exit 0 → respawn. Dispose-before-
activate ordering asserted by `tests/bun/watch.spec.ts`.

Phase 5B verdict: `--hot` unsuitable (duplication, above). Phase 5C
(selective HMR): deferred — optional per success criteria; adapter design
sketch recorded in BUN_COMPATIBILITY.md.

### Full-suite phase boundary results

```
bun test tests/bun                  # 58 pass / 0 fail / 198 expect() calls
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

## Current failures

None.

## Next action

- Push branch / open PR is owner-gated (explicit approval required).
- Optional future work: Phase C selective HMR adapter if whole-process
  reload proves inadequate; browser export of logger-console under Bun;
  `create-cordis` runtime verification.

## Commit SHAs

- `06ae971` — Phase 0–3: Bun behavioral suite + plan/status docs + loader
  devDependency fix
- `a8499bd` — Phase 4–5: entrypoints, supervisor, CI, compatibility docs

Branch: `feat/bun-compat` (2 commits ahead of `8cc9e33` == `upstream/main`;
push/PR is owner-gated).
