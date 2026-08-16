# Cordis Bun Port — Phased Implementation Plan

This fork aims to be a **first-class Bun-compatible implementation** of Cordis while:

- preserving the existing Node implementation and its test suite verbatim,
- keeping a clean merge path against `cordiverse/cordis` (no invasive conditionals in core),
- never changing public Cordis semantics to accommodate Bun,
- never touching undocumented Bun module-loader internals.

## Recorded baseline (2026-08-16)

| Item | Value |
| --- | --- |
| Fork HEAD at start | `8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4` (`chore: update readme (#45)`) |
| Divergence vs `upstream/main` | 0 / 0 (identical) |
| Upstream remote | `https://github.com/cordiverse/cordis.git` (added, fetched) |
| Origin | `https://github.com/ebowwa/cordis.git` |
| Working branch | `feat/bun-compat` |
| Node | `v26.4.0` (/opt/homebrew/bin/node) |
| npm | `11.17.0` |
| Yarn | pinned `yarn@4.14.1` in `package.json` — **not resolvable**: the configured registry's yarn dist-tags max out at `2.4.3` (no 4.x published there), and `corepack` is not shipped with Node 26.4.0 |
| Bun | `1.3.14` — revision `1.3.14+0d9b296af` (`~/.bun/bin/bun`) — **pinned target for this port** |
| Bun's reported `process.versions.node` | `24.3.0` |

### Baseline commands and results (Node)

```
bun install                                    # 864 packages, lockfile saved (locally ignored)
node --expose-internals --import tsx --import @cordisjs/unyaml \
  node_modules/yakumo/lib/cli.js esbuild       # 11 outputs, exit 0
node --expose-internals --import tsx --import @cordisjs/unyaml \
  node_modules/yakumo/lib/cli.js tsc           # all .d.ts emitted, exit 0
node --expose-internals --import tsx --import @cordisjs/unyaml \
  node_modules/yakumo/lib/cli.js vitest --import tsx
                                               # 19 files / 163 tests PASSED, exit 0
```

Note on tooling substitution: because Yarn 4.14.1 cannot be resolved from this
environment's registry, dependency installation is done with Bun (which the port
requires anyway) and yakumo/vitest/esbuild/tsc are invoked exactly as the
`yarn yakumo` script would invoke them (`node --expose-internals --import tsx
--import @cordisjs/unyaml node_modules/yakumo/lib/cli.js …`). The Node build and
test toolchain itself is unchanged; only the installer differs. `yarn.lock` is
not committed upstream and `bun.lock` is locally ignored, so the merge path is
unaffected.

## Architectural findings (read-only audit)

1. **`cordis` core (`packages/core`) has zero Node-specific imports in `src/`.**
   It is pure JS + `cosmokit` + `@standard-schema/spec`. Expected to run under
   Bun unmodified.

2. **The single true Node seam is `packages/loader/src/internal.ts`.**
   `ModuleLoader.fromInternal()` requires Node internals
   (`internal/modules/esm/loader`, gated on `--expose-internals` or the optional
   `node-addon-require-builtin` peer). Verified under Bun 1.3.14: the internal
   require throws `MODULE_NOT_FOUND` (caught), so `fromInternal()` returns
   `undefined`.

3. **The loader already has a graceful fallback for that case.**
   `EntryTree.import()` (`packages/loader/src/config/tree.ts`) checks
   `ctx.loader.internal` and, when absent, resolves relative specifiers against
   `ctx.baseUrl` and performs a standard `await import(...)`. Under Bun this
   exercises Bun's native TS/ESM/CJS loader. **This is the runtime adapter seam
   the port formalizes — no new conditional spaghetti is needed to make the
   loader work.**

4. **`@cordisjs/plugin-hmr` hard-requires Node internals** (`throw new
   Error('--expose-internals is required for HMR service')` when
   `loader.internal` is undefined) and manipulates the internal ESM `loadCache`
   plus CJS `require.cache` directly. It is correctly classified **Node-only**
   for now; Bun reload is provided by the Phase 5 progression instead.

5. Node-API usage elsewhere is Bun-supported surface:
   - `include`: `node:path`, `node:fs/promises`, `node:url` + `js-yaml` (pure JS)
   - `logger-console`: `node:util.inspect`, `supports-color`, `schemastery`
   - `timer`: globals only (`setTimeout`/`setInterval`/`Promise.withResolvers`)
   - `create`: `node:fs/promises`, `node:child_process.execSync`, `node:stream`
   - `loader/src/index.ts`: `process.env.CORDIS_SHARED`
   - `loader/src/config/utils.ts`: `new Function` + `with`/`eval` (standard JS)
   - `core/bin.js`: `node:url`, `process.cwd()` — plain ESM entry

6. The root CLI entry `packages/core/bin.js` is runtime-neutral ESM (Context +
   Loader + include on `./cordis.yml`). It is the basis for the Bun entrypoint.

## Phases

### Phase 0 — Audit and baseline (this document + `BUN_PORT_STATUS.md`)
Read-only audit, toolchain recording, upstream remote, baseline build/test,
working branch. **No behavioral changes.**

### Phase 1 — Core under Bun
- Per-package smoke: install / build / import / basic runtime under Bun.
- Behavioral suite (`tests/bun/`, run with `bun test`) covering: function /
  object / class plugins; sync and async effects; reverse disposal order;
  nested plugin cleanup; provide/inject activation; dependency removal and
  reactivation; provider replacement; isolated contexts; all dispatch modes
  (`emit`/`parallel`/`serial`/`bail`/`waterfall`).

### Phase 2 — Timer and logger-console under Bun
- Timer: `timeout`/`interval` (callback + iterable forms), `throttle`/
  `debounce`, disposal clears all pending timers.
- logger-console: console export with Bun's `node:util.inspect`, colors off in
  CI.

### Phase 3 — Loader and include under Bun
- JSON and YAML configuration loading; `evaluate`/`interpolate` (`__jsExpr`);
  dynamic TypeScript plugin loading through the fallback import path; entry
  update/disable; group and isolate; repeated load/dispose cycles asserting no
  listener/timer duplication; full root-context disposal at process shutdown.

### Phase 4 — Bun CLI/entrypoint + CI matrix
- `packages/core/bin.bun.js` (or verified reuse of `bin.js`) + npm script
  aliases that do not disturb the Node scripts.
- GitHub Actions matrix job: Bun (pinned 1.3.14) alongside the existing Node
  24/26 jobs, running install + build + `bun test` behavioral suite. Existing
  jobs untouched.

### Phase 5 — Development reload progression
- **A.** `bun --watch` entrypoint with graceful root-fiber disposal before
  process restart (SIGINT/SIGTERM handlers around `ctx.root.fiber.dispose()` /
  root restart semantics).
- **B.** Evaluate `bun --hot`: document whether re-evaluation duplicates Cordis
  state (registries, listeners, timers) — with a minimal repro if it does.
- **C.** Only if A+B are inadequate: design a selective-HMR runtime adapter
  abstraction. Node's existing `ModuleLoader` internal adapter stays the Node
  implementation; a Bun adapter would be built strictly on public APIs
  (fs watching, `Bun.build` dependency metadata, content-hashed artifacts,
  unique artifact paths, export validation before replacement, old-fiber config
  preservation, dispose→activate ordering, rollback on failure). **Do not**
  emulate Node's private ModuleLoader for Bun.

## Bun contribution policy (restated)

A fix goes to Bun only when: reduced to a standalone minimal repro outside
Cordis; failing on the latest Bun release; checked against Bun main when
practical; supported by Bun's public API; unsolvable in a Cordis adapter; after
searching existing Bun issues/PRs; with a regression test included. All Bun-side
work happens in a separate checkout/branch. No external PRs or publishes
without the owner's explicit approval. See `BUN_COMPATIBILITY.md` for the
running list of repros.

## Invariants

- The Node suite (`yarn test` equivalent) stays green at every phase boundary.
- The Bun suite must not weaken or delete failing tests — failures are fixed or
  documented as blockers.
- Every phase ends by running both suites and recording results in
  `BUN_PORT_STATUS.md`.
