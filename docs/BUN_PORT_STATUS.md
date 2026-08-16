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
