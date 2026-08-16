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

### Phase 0 — read-only audit (DONE)

Commands and results: see git history of this file (first version) and
`BUN_PORT_PLAN.md`. Summary:

```
git status --porcelain=v1 -b        # -> clean
git rev-parse HEAD                  # -> 8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4
git remote add upstream https://github.com/cordiverse/cordis.git && git fetch upstream
git rev-list --left-right --count HEAD...upstream/main   # -> 0 0
bun install                         # 864 packages, exit 0
yakumo esbuild / tsc (via node --import tsx ...)         # exit 0
yakumo vitest --import tsx           # 19 files / 163 tests passed, exit 0
```

Key findings: core has zero `node:*` imports; `ModuleLoader.fromInternal()` →
`undefined` under Bun; `EntryTree.import()` falls back to standard
`await import()`; hmr is Node-only by construction.

### Phases 1–3 — Bun behavioral suite (DONE, 57/57 green)

Suite: `tests/bun/` (run with `bun test tests/bun`), 10 spec files, 57 tests:

- `core-plugin.spec.ts` — function/object/class plugins, invalid plugins,
  nested listeners, root dispose idempotency, Service.init
- `core-effects.spec.ts` — sync/async effects, within-effect reverse disposal,
  async-generator abort semantics, hook-snapshot parity across reload cycles
- `core-events.spec.ts` — on/once/emit/parallel/serial/bail/waterfall
- `core-services.spec.ts` — provide/inject activation, dependency removal +
  reactivation, provider replacement, chained injects
- `core-isolate.spec.ts` — isolated contexts, shared labels, isolated events
- `timer.spec.ts` — timeout/interval (callback/promise/iterator),
  throttle/debounce, full timer cleanup on dispose
- `logger-console.spec.ts` — render parity with Bun's `node:util.inspect`
- `loader-mock.spec.ts` — in-memory loader tree: init/update/self-update/
  self-dispose, intercept-await activation gating
- `loader-include.spec.ts` — real files: YAML + JSON config loading, relative
  + absolute plugin references, dynamic TS plugin import, `__jsExpr`
  evaluation, 3× disable/enable cycles with no duplicated listeners/timers,
  patch-based disable
- `shutdown.spec.ts` — SIGINT → complete root-fiber disposal → exit 0

```
$ bun test tests/bun
 57 pass
 0 fail
 188 expect() calls
Ran 57 tests across 10 files. [4.35s]
```

### Cordis changes made so far (vs upstream)

1. `packages/loader/package.json` — added `@cordisjs/plugin-include` to
   `devDependencies` (mirrors the existing `@cordisjs/plugin-logger-console`
   entry). Reason: Bun installs isolated per-workspace `node_modules`; the
   loader's fallback `import('@cordisjs/plugin-include')` executes from
   `packages/loader`, where the package was not visible (only `hmr` declared
   it). Under Yarn's hoisting this worked by accident. No runtime code
   changed; Node behavior unchanged.
2. `tests/bun/**`, `docs/BUN_PORT_*.md` — new files only.

### Verified Node↔Bun parity facts (documented for BUN_COMPATIBILITY.md)

- Cross-fiber disposal order is async-depth ordered (`outer,inner,innermost`),
  **byte-identical under Node v26.4.0 and Bun 1.3.14** — not LIFO across
  fibers (upstream never asserts cross-fiber order; within a single effect it
  is strict reverse).
- `!js` YAML shorthand: `js-yaml@4.3.1` rejects `!js '...'` under BOTH Node
  and Bun ("unknown tag"); the working explicit form is
  `!<tag:yaml.org,2002:js> '...'` (what Include's dump writes). The `!js`
  shorthand is only handled by `@cordisjs/unyaml` at test-import time.
- Bun resolves extensionless relative `.ts` imports (`./mod` → `mod.ts`) and
  `file://` URL imports — the loader fallback path works unmodified.
- Bun's `util.inspect` output matches Node's for the logger-console formats
  tested (`{ foo: 'bar' }`, `{ a: 1 }`).

## Current failures

None. Node suite re-run after the loader devDependency change: see below.

## Next action

Phase 4: Bun CLI/entrypoint verification (app-like fixture), root
`test:bun` script, Node+Bun CI matrix workflow.

Phase 5: reload progression A (`bun --watch` + graceful root-fiber disposal),
B (`bun --hot` evaluation), C (HMR decision).

## Commit SHAs

(pending — first commit after this status update)
