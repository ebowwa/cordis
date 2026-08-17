# Cordis on Bun — Compatibility Documentation

Status: **core, timer, logger-console, loader and include are verified
first-class under Bun.** hmr is Node-only by design. Everything else is
classified below.

- Verified Bun release: **1.3.14** (revision `1.3.14+0d9b296af`, macOS arm64)
- Verified Node releases: v26.4.0 (locally), v24/v26 (upstream CI unchanged)
- Behavioral proof: `bun test tests/bun` — 68 tests across 13 spec files
  covering the scenarios listed in "What is verified" below (3 of them are
  gated on the oven-sh/bun#32856 PR build and skip cleanly when it is not
  installed).
- Performance proof: see **`docs/BUN_BENCH.md`** — fork ≡ upstream under
  Node (control), and Bun is faster on every Cordis operation (up to ~5x
  plugin lifecycle, ~4x config boot, ~80x TS module eval).
- Compatibility is **not** claimed from installation or typechecking alone;
  every claim below maps to an executable test or a recorded command.

## Package compatibility matrix

Legend: ✅ verified · 🟡 works but not behaviorally verified · ❌ incompatible /
Node-only · ⬜ not yet tested

| Package | install (bun) | build | import | tests (bun) | runtime | Node-specific APIs | Bun incompatibilities | Fix owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cordis` (core) | ✅ | ✅ (esbuild+tsc) | ✅ | ✅ 57-test suite | ✅ full | **none in src** | none found | — |
| `@cordisjs/plugin-timer` | ✅ | ✅ | ✅ | ✅ timer.spec | ✅ | globals only (`setTimeout`, `Promise.withResolvers`) | none found | — |
| `@cordisjs/plugin-logger-console` | ✅ | ✅ | ✅ (node and browser exports) | ✅ logger-console + logger-console-browser specs | ✅ | `node:util.inspect`, `supports-color` (node build only — the browser build imports neither) | none found — `util.inspect` output byte-identical for tested formats; browser build needs only a `console` | — |
| `@cordisjs/plugin-loader` | ✅ | ✅ | ✅ | ✅ loader-mock + loader-include specs | ✅ | `node:module` (optional, degrades), `process.env` | none found; `ModuleLoader.fromInternal()` returns `undefined` → documented fallback `import()` path is used | — (fallback is upstream design) |
| `@cordisjs/plugin-include` | ✅ | ✅ | ✅ | ✅ loader-include spec | ✅ | `node:path`, `node:fs/promises`, `node:url`, `js-yaml` | none found | — |
| `@cordisjs/plugin-hmr` | ✅ | ✅ | ✅ | ❌ by design | ❌ **Node-only** | `--expose-internals` ESM `loadCache`, CJS `require.cache`, `node:module` | constructor fails fast: `--expose-internals is required for HMR service` (no Bun internals access — per policy, not attempted) | Cordis (Phase C adapter) or stay Node-only |
| `@cordisjs/plugin-group` | ✅ | ✅ | ✅ | 🟡 (via loader-mock `Group` usage) | 🟡 | none | none found | — |
| `@cordisjs/utils` | ✅ | ✅ | ✅ | ⬜ standalone | 🟡 (pure JS over core) | none | none found | — |
| `create-cordis` | ✅ | ✅ | ✅ | ⬜ (interactive CLI) | 🟡 | `node:fs/promises`, `node:child_process.execSync`, `node:stream.Readable` | untested at runtime; `execSync` of yarn is expected to work only if yarn exists | — |
| repo toolchain (yakumo/vitest/eslint) | ✅ install | ✅ via `node --import tsx` | n/a | ✅ Node suite runs under Node as before | n/a | `--expose-internals` (Node) | running the *Node* suite under bun is not supported (tsx/vitest pools) — not needed; Bun has its own suite | — |

Notes on the matrix:

- "install (bun)" was verified with `bun install` at the repo root
  (864 packages) and per-package workspace linking.
- "build" is the shared yakumo esbuild+tsc pipeline executed under Node;
  building under Bun's bundler is neither required nor claimed.
- `@cordisjs/plugin-loader` needed a resolution fix for Bun's isolated
  workspace linking — solved at the **repo root**, not in the loader package
  (see "Cordis changes" below). This is an install-layout issue, not a Bun
  defect.

## What is verified (behavioral, under `bun test tests/bun`)

`tests/bun/` — 68 tests (58 core + 7 browser-export + 3 PR-build-gated):

- **Plugins**: function / object / class plugins, config passing, invalid
  plugins rejected, nested plugin trees, idempotent root dispose,
  `Service.init` lifecycle (`core-plugin.spec.ts`)
- **Effects**: sync disposers, within-effect reverse disposal order, async
  (promise) effects, async-generator effects including mid-segment abort,
  hook-registry snapshot parity across load/dispose cycles
  (`core-effects.spec.ts`)
- **Events**: `on`/`once`/`emit` (synchronous), `parallel` (AggregateError,
  no short-circuit), `serial` (order + bail), `bail` (null/false/undefined
  never bail), `waterfall` (`next()` composition + short-circuit)
  (`core-events.spec.ts`)
- **provide/inject**: deferred activation via `Service.init`, activation on
  provide, deactivation on removal, reactivation, provider replacement,
  chained injects (`core-services.spec.ts`)
- **Isolation**: distinct service instances per isolated context, shared
  labels, isolated event dispatch (`core-isolate.spec.ts`)
- **Timer**: timeout (callback/promise), interval (callback/async-iterator:
  return/throw/break/dispose), throttle (leading+trailing), debounce, full
  timer cleanup on context disposal (`timer.spec.ts`)
- **logger-console**: render parity for messages, stackless errors, objects,
  `%o` formatters, log levels — using Bun's `node:util.inspect`
  (`logger-console.spec.ts`)
- **logger-console browser export**: loaded by path (`lib/browser.js`, the
  file the export map's `default` condition serves to non-node consumers);
  plugin wiring via `ctx.plugin`; error→`console.error`,
  warn→`console.warn`, else→`console.log` with the `[T] name` prefix;
  arguments passed through **by identity** (the exporter never serializes —
  native console does the inspecting); levels respected; works with
  `document`/`window` hard-absent; declaratively: export map routes
  non-node consumers to `browser.js`, and the shipped artifact contains
  zero `node:` specifiers (`logger-console-browser.spec.ts`)
- **Loader + include**: in-memory tree (init/update/self-update/self-dispose,
  intercept-`await` gating); real files: YAML and JSON config loading,
  relative and absolute plugin references, **dynamic TypeScript plugin
  loading** via the standard `import()` fallback with Bun's transpiler,
  `__jsExpr` evaluation, entry disable/enable patches, **3× disable/enable
  cycles with no duplicated listeners or timers** (`loader-mock.spec.ts`,
  `loader-include.spec.ts`)
- **Process shutdown**: SIGINT → complete root-fiber disposal (registry
  empties, all disposers run exactly once) → exit 0 (`shutdown.spec.ts`)
- **Development reload (supervisor)**: restart contract — old root disposed
  before new activation, no resource duplication, clean SIGINT
  (`watch.spec.ts`)
- **Development reload (bun#32856 PR build, `--hot` + `import.meta.hot`)**:
  awaited root disposal completes before reactivation (async disposer),
  resources never duplicate across reloads, a module the next generation no
  longer imports is disposed and its resources stop, failed evaluation still
  disposes the old root and recovers on the next edit
  (`hot.spec.ts`, skips when the PR binary is absent)

Commands and recorded results:

```
$ bun --version && bun --revision
1.3.14
1.3.14+0d9b296af

$ bun install
864 packages installed [5.83s]

$ node --expose-internals --import tsx --import @cordisjs/unyaml \
    node_modules/yakumo/lib/cli.js esbuild   # exit 0
$ node --expose-internals --import tsx --import @cordisjs/unyaml \
    node_modules/yakumo/lib/cli.js tsc       # exit 0

$ bun test tests/bun
 68 pass / 0 fail / 248 expect() calls  # 58 core + 7 browser-export on
                                         # stock Bun + 3 PR-gated hot tests
                                         # when the bun#32856 build is
                                         # installed (they skip otherwise)

$ HOME=/tmp/no-such-home bun test tests/bun/hot.spec.ts   # PR binary hidden
 0 pass / 3 skip / 0 fail

$ node --expose-internals --import tsx --import @cordisjs/unyaml \
    node_modules/yakumo/lib/cli.js vitest --import tsx
 19 files / 163 tests passed            # Node suite unchanged and green
```

## Using Cordis on Bun

```bash
bun install                      # in your application

# production-style entrypoint (same layout as bin.js):
bun path/to/packages/core/bin.bun.js
# reads ./cordis.yml, loads plugins (TypeScript included), handles
# SIGINT/SIGTERM with full root-fiber disposal

# development with graceful reload (hard restart per file change):
bun path/to/packages/core/bin.bun.watch.js

# development with in-process reload — requires a Bun build shipping
# oven-sh/bun#32856 (import.meta.hot); until then resources would duplicate.
# NOTE: config (cordis.yml) edits are NOT watched in this mode — only
# modules; use the supervisor above if you edit configs often:
bun --hot path/to/packages/core/bin.bun.js
```

Minimal application:

```yaml
# cordis.yml
- id: timer
  name: '@cordisjs/plugin-timer'
- id: my-plugin
  name: ./my-plugin.ts
```

```ts
// my-plugin.ts — plain TypeScript, loaded via dynamic import
import { Context } from 'cordis'

export function apply(ctx: Context) {
  ctx.on('some-event', () => {})
  ctx.interval(() => {/* ... */}, 1000)
}
```

## Development reload semantics (Phase 5, re-verified)

**Decision: on stock Bun (≤ 1.3.14), the whole-process supervisor
(`bin.bun.watch.js`) is the supported reload mechanism. With
[oven-sh/bun#32856](https://github.com/oven-sh/bun/pull/32856)
(`import.meta.hot` for `bun --hot`), in-process reload becomes viable — see
"Upstream integration: bun#32856" below.**

Per [Bun's watch-mode documentation](https://bun.sh/docs/runtime/watch-mode),
`--watch` is a hard restart and `--hot` is an in-process soft reload that
preserves `globalThis`. Re-verified on Bun 1.3.14 with standalone probes
(a `globalThis` generation counter, a ticking interval, and a signal handler,
two file edits per run):

1. `bun --watch` **restarts the runtime**: on every reload `globalThis` is
   fresh (the counter resets to 1), the module registry is cleared, and
   pending timers are removed *without* running Cordis disposers. A signal
   handler registered in generation 1 fires **exactly once** after three
   reloads — handlers do **not** accumulate. (Implementation detail: the OS
   pid happens to stay the same on 1.3.14 — the restart happens in place —
   but no JS state survives it.) There is **no public before-reload hook**,
   so Cordis-level graceful disposal cannot run on reload; only the
   supervisor's SIGTERM path disposes.
2. `bun --hot` **re-evaluates the changed module and its importers
   in-process**, preserving `globalThis` (the counter increments
   1 → 2 → 3 across reloads): previous generations' **timers and signal
   listeners keep running** — after three reloads, one signal fired **three**
   registered handlers — so Cordis state (registries, effects) is
   **duplicated** across reloads. On 1.3.14 `import.meta.hot` is `undefined`
   in *both* modes, so user code had no cleanup hook.

Therefore:

- **A (implemented, tested)**: `packages/core/bin.bun.watch.js` supervises a
  child process running `bin.bun.js`; on file change it sends SIGTERM, the
  child performs a complete root-fiber disposal, exits 0, and is respawned.
  Restart ordering (dispose → activate) is asserted by `tests/bun/watch.spec.ts`.
- **B (evaluated)**: `bun --hot` on stock 1.3.14 is unsuitable as-is — no
  `import.meta.hot`, and resources accumulate. `bin.bun.js` nevertheless
  carries the correct defensive strategy for this mode: it stores the root
  context on `globalThis` and disposes the previous root before activating
  the new one, so a `--hot` re-evaluation of the entrypoint cannot leak
  whole roots. (Under `--watch` the `globalThis` slot is always empty at
  boot, so the guard is a harmless no-op there.)
- **Bun PR #32856** implements `import.meta.hot` for `bun --hot`:
  awaited `dispose()` callbacks run to completion **before** re-evaluation,
  per-module `hot.data` persists across reloads, timers/listeners can be
  cleaned up, and modules no longer imported are disposed too. Cordis-side
  validation of the PR build lives in `tests/bun/hot.spec.ts` (see below).
- **C (deferred)**: selective HMR would require a runtime-adapter abstraction
  (Node adapter = current `ModuleLoader` internals; Bun adapter built on
  public APIs: fs watching, `Bun.build` dependency metadata, content-hashed
  artifacts, unique artifact import paths, export validation, old-fiber
  config preservation, dispose→activate ordering, rollback). This is only
  worth building if whole-process reload proves inadequate in practice —
  per the port's success criteria it is optional.

## Upstream integration: oven-sh/bun#32856

[PR #32856](https://github.com/oven-sh/bun/pull/32856) ("Implement
import.meta.hot for bun --hot") gives `bun --hot` the missing cleanup hook:
awaited `dispose()` callbacks that run to completion **before**
re-evaluation, persistent per-module `hot.data`, and disposal of modules the
next generation no longer imports. Cordis consumes this PR as a downstream
integration fixture — it does not reimplement module reloading and needs no
Bun fork or source changes.

**Installing the PR build (no Bun checkout required):**

```bash
bunx bun-pr 32856
bun-32856 --version                                   # 1.4.0 (PR CI artifact)
bun-32856 --hot packages/core/bin.bun.js              # in your app dir
```

`tests/bun/hot.spec.ts` locates the binary automatically (exact
`bun-32856` alias or `bun-<sha>-pr32856` in `~/.bun/bin`, or the
`BUN_PR_BIN` environment variable) and skips when absent.

**Verified against the PR build (probes + `tests/bun/hot.spec.ts`):**

- `import.meta.hot` is an object under `--hot` (and `undefined` without the
  flag — unchanged plain-run behavior).
- `hot.data` persists across reloads (read `{"gen":1}` in generation 2).
- Editing a **dynamically imported** module reloads the whole reachable
  graph: dispose callbacks of the entry *and* the plugin run — awaited —
  strictly before any re-evaluation. This is exactly Cordis's
  dispose-before-activate contract.
- With `bin.bun.js` registering `import.meta.hot.dispose(() =>
  disposePrevious())`: a 150 ms async disposer completes before the next
  generation activates; no timer duplication across 3 generations; a broken
  generation still gets the old root disposed first and the next valid edit
  recovers; SIGINT exits 0.
- **Removed modules**: when generation 2 of the plugin drops its import of a
  helper module, the helper's own `import.meta.hot.dispose` callback runs —
  and the Cordis root-fiber disposal completes — both strictly before
  generation 2 activates, and the helper's timer never fires again.
  This is the PR's "disposal for modules no longer imported" claim, verified
  against Cordis.

**Known `--hot` limitation (verified on the PR build):** editing
`cordis.yml` triggers **no reload** — config files are not part of the
module graph (observed: zero output after a config edit). To reload on
config changes, use the supervisor (`bin.bun.watch.js`, whose `fs.watch`
does catch them) or touch a watched module.

**Result: no failure to report.** Every Cordis case — root-fiber disposal,
async cleanup, dynamic plugins, removed plugins, repeated reloads, failed
evaluation — passed on the first PR build tried (artifact from the Aug 13,
2026 CI run, verified on macOS arm64 and Linux in CI); steps 3–5 of the
integration plan (reduce a failure, clone/build Bun) were not triggered.

**When the PR ships in a release**: drop the PR-binary gating in
`hot.spec.ts`, re-pin the CI Bun version, and document `--hot` as the
supported in-process development reload (the supervisor remains the
`--watch`-style hard-restart option).

## Known behavior nuances (Node ↔ Bun parity)

These are **not** incompatibilities — behavior is identical on both runtimes;
recorded because they surprised the port itself:

- **Cross-fiber disposal order is async-depth order** (a parent's own sync
  disposers run before its nested child fiber's chain), *not* LIFO across
  fibers. Verified byte-identical on Node v26.4.0 and Bun 1.3.14. Within a
  single effect, disposers run in strict reverse order on both runtimes.
- **`!js` YAML shorthand** (`stamp: !js '...'`) is rejected by `js-yaml@4`
  on *both* runtimes ("unknown tag"). The canonical explicit form —
  `!<tag:yaml.org,2002:js> '...'`, which Include itself writes on dump —
  works everywhere. The bare `!js` shorthand only parses via
  `@cordisjs/unyaml` at test-import time.
- **Bun resolves extensionless relative `.ts` imports** (`./plugin` →
  `plugin.ts`) and `file://` URL imports, so the loader's fallback path and
  Include configs referencing `./plugin.ts` work unmodified.
- **Bundling from inside this repo resolves workspace packages via
  `tsconfig.json` `paths` (`@cordisjs/plugin-*` → `packages/*/src`), which
  takes precedence over the packages' export maps.** Both `Bun.build` and
  esbuild behave this way, and both therefore select the *node* source when
  bundling a bare `@cordisjs/*` import from within the repo — regardless of
  `target: 'browser'`. This is repo-config behavior, not a Bun defect and
  not export-map behavior: the published package's export map (`node` →
  `lib/index.js`, `default` → `lib/browser.js`) is what real-world browser
  bundlers consume, and it is verified declaratively in
  `logger-console-browser.spec.ts`. (Bun's `--conditions` is *additive*, so
  it cannot remove the `node` condition either.)
- Bun reports `process.versions.node` = `24.3.0`; `internal/modules/*`
  requires fail with `MODULE_NOT_FOUND`, which the loader already treats as
  "internals unavailable" (falling back to standard `import()`).

## Cordis changes versus Bun changes

**Cordis-side (this fork, branch `feat/bun-compat`):**

1. Root `package.json`: added `@cordisjs/plugin-include` (plus `cordis`,
   `@cordisjs/plugin-loader`, `@cordisjs/plugin-timer` for `bench/`) to
   `devDependencies`. Under Bun's isolated workspace `node_modules`, the
   loader's fallback `import('@cordisjs/plugin-include')` executes from
   `packages/loader`; with the package declared at the repo root it resolves
   via the parent-directory walk-up (root `node_modules`). Under Yarn
   hoisting this is a no-op.
   **Note:** declaring it inside `packages/loader/package.json` instead
   would create a `plugin-loader → plugin-include → plugin-loader` cycle in
   yakumo-tsc's build graph (`Error: circular dependency detected`) —
   deliberately avoided; `packages/loader/package.json` stays
   upstream-identical.
2. `packages/core/bin.bun.js`, `packages/core/bin.bun.watch.js`: Bun
   entrypoint + development supervisor (additive; not in the published
   `files` list; Node's `bin.js` untouched). `bin.bun.js` registers
   `import.meta.hot.dispose` when the runtime provides it (PR #32856
   integration; no-op on stock Bun/Node).
3. `tests/bun/**`: Bun-native behavioral suite, including the PR-build-gated
   `hot.spec.ts` (does not affect the Node suite).
4. Root `package.json` scripts: `test:bun`, `start:bun`, `dev:bun`
   (additive).
5. `.github/workflows/bun.yml`: Bun CI alongside the untouched Node CI.
6. `docs/BUN_PORT_*.md`, this file.

**Bun-side: no source changes.** The contribution policy was never
triggered: no defect qualifying under the seven conditions was found. The two
candidate findings (cross-fiber disposal order; `!js` tag handling)
reproduced identically on Node and are therefore Cordis/js-yaml semantics,
not Bun bugs. The stock-Bun `--watch`/`--hot` reload behaviors are documented
platform semantics with public-API workarounds (supervisor; the
`globalThis` root guard), not defects against documented behavior — and the
remaining `--hot` gap (no cleanup hook) is being fixed upstream by
oven-sh/bun#32856, which this fork consumes as an integration fixture (see
"Upstream integration" above; all Cordis cases passed, nothing to report).

## Limitations

- `@cordisjs/plugin-hmr` does not run under Bun and fails fast with a clear
  error. Use the supervisor for development reload.
- The `create-cordis` scaffolder is untested under Bun (classified ⬜ above).
- The Bun behavioral suite uses real timers; timing assertions carry wide
  margins. The Node suite remains the source of truth for fake-timer
  precision cases.
- The logger-console **browser** export is verified under Bun with a
  `console` and no DOM — i.e. as the universal build it is. It is not
  verified inside an actual browser engine (that would be a web-testrunner
  concern, not a Bun-runtime one).
