# Cordis on Bun — Compatibility Documentation

Status: **core, timer, logger-console, loader and include are verified
first-class under Bun.** hmr is Node-only by design. Everything else is
classified below.

- Verified Bun release: **1.3.14** (revision `1.3.14+0d9b296af`, macOS arm64)
- Verified Node releases: v26.4.0 (locally), v24/v26 (upstream CI unchanged)
- Behavioral proof: `bun test tests/bun` — 58 tests across 11 spec files
  covering the scenarios listed in "What is verified" below.
- Compatibility is **not** claimed from installation or typechecking alone;
  every claim below maps to an executable test or a recorded command.

## Package compatibility matrix

Legend: ✅ verified · 🟡 works but not behaviorally verified · ❌ incompatible /
Node-only · ⬜ not yet tested

| Package | install (bun) | build | import | tests (bun) | runtime | Node-specific APIs | Bun incompatibilities | Fix owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cordis` (core) | ✅ | ✅ (esbuild+tsc) | ✅ | ✅ 57-test suite | ✅ full | **none in src** | none found | — |
| `@cordisjs/plugin-timer` | ✅ | ✅ | ✅ | ✅ timer.spec | ✅ | globals only (`setTimeout`, `Promise.withResolvers`) | none found | — |
| `@cordisjs/plugin-logger-console` | ✅ | ✅ | ✅ (node export; browser export untested) | ✅ logger-console.spec | ✅ | `node:util.inspect`, `supports-color` | none found — `util.inspect` output byte-identical for tested formats | — |
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
- `@cordisjs/plugin-loader` needed one **devDependency addition**
  (`@cordisjs/plugin-include`) — see "Cordis changes" below. This is an
  install-layout issue, not a Bun defect.

## What is verified (behavioral, under `bun test tests/bun`)

`tests/bun/` — 58 tests, all passing on Bun 1.3.14:

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
- **Loader + include**: in-memory tree (init/update/self-update/self-dispose,
  intercept-`await` gating); real files: YAML and JSON config loading,
  relative and absolute plugin references, **dynamic TypeScript plugin
  loading** via the standard `import()` fallback with Bun's transpiler,
  `__jsExpr` evaluation, entry disable/enable patches, **3× disable/enable
  cycles with no duplicated listeners or timers** (`loader-mock.spec.ts`,
  `loader-include.spec.ts`)
- **Process shutdown**: SIGINT → complete root-fiber disposal (registry
  empties, all disposers run exactly once) → exit 0 (`shutdown.spec.ts`)
- **Development reload**: supervisor restart contract — old root disposed
  before new activation, no resource duplication, clean SIGINT
  (`watch.spec.ts`)

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
 58 pass / 0 fail / 198 expect() calls

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

# development with graceful reload:
bun path/to/packages/core/bin.bun.watch.js
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

## Development reload decision (Phase 5)

**Decision: whole-process supervisor (`bin.bun.watch.js`) is the supported
Bun reload mechanism. Selective HMR is deferred — see below.**

Measured on Bun 1.3.14 (each claim reproduced with standalone scripts):

1. `bun --watch` re-evaluates the entry **in-process** (same pid):
   - module state is cleared, but **`globalThis` and `process` are fresh on
     every reload** — the new evaluation cannot reach the previous Cordis
     root context;
   - pending **timers from the previous evaluation are removed by Bun**, but
     *without* running Cordis disposers (no cleanup of listeners, sockets,
     watchers, or user callbacks);
   - **signal handlers from previous evaluations persist and accumulate**;
   - there is **no public before-reload hook**, so Cordis-level graceful
     disposal cannot be implemented from inside the reloaded module.
2. `bun --hot` re-evaluates the changed module *and* importers: previous
   evaluations' **timers and listeners keep running** — Cordis state
   (registries, effects) is **duplicated** across reloads. Confirmed by
   interleaved output from two generations.

Therefore:

- **A (implemented, tested)**: `packages/core/bin.bun.watch.js` supervises a
  child process running `bin.bun.js`; on file change it sends SIGTERM, the
  child performs a complete root-fiber disposal, exits 0, and is respawned.
  Restart ordering (dispose → activate) is asserted by `tests/bun/watch.spec.ts`.
- **B (evaluated, documented above)**: `bun --hot` is unsuitable as-is.
- **C (deferred)**: selective HMR would require a runtime-adapter abstraction
  (Node adapter = current `ModuleLoader` internals; Bun adapter built on
  public APIs: fs watching, `Bun.build` dependency metadata, content-hashed
  artifacts, unique artifact import paths, export validation, old-fiber
  config preservation, dispose→activate ordering, rollback). This is only
  worth building if whole-process reload proves inadequate in practice —
  per the port's success criteria it is optional.

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
- Bun reports `process.versions.node` = `24.3.0`; `internal/modules/*`
  requires fail with `MODULE_NOT_FOUND`, which the loader already treats as
  "internals unavailable" (falling back to standard `import()`).

## Cordis changes versus Bun changes

**Cordis-side (this fork, branch `feat/bun-compat`):**

1. `packages/loader/package.json`: added `@cordisjs/plugin-include` to
   `devDependencies` (mirrors existing `@cordisjs/plugin-logger-console`
   entry). Under Bun's isolated workspace `node_modules`, the loader's
   fallback `import('@cordisjs/plugin-include')` executes from
   `packages/loader` where that package was not previously visible. Under
   Yarn hoisting this worked by accident. No runtime code changed.
2. `packages/core/bin.bun.js`, `packages/core/bin.bun.watch.js`: Bun
   entrypoint + development supervisor (additive; not in the published
   `files` list; Node's `bin.js` untouched).
3. `tests/bun/**`: Bun-native behavioral suite (does not affect the Node
   suite).
4. Root `package.json` scripts: `test:bun`, `start:bun`, `dev:bun`
   (additive).
5. `.github/workflows/bun.yml`: Bun CI alongside the untouched Node CI.
6. `docs/BUN_PORT_*.md`, this file.

**Bun-side: none.** The contribution policy was never triggered: no defect
qualifying under the seven conditions was found. The two candidate findings
(cross-fiber disposal order; `!js` tag handling) reproduced identically on
Node and are therefore Cordis/js-yaml semantics, not Bun bugs. The
`--watch`/`--hot` reload behaviors are documented platform semantics with a
public-API workaround (supervisor), not defects against documented behavior.

## Limitations

- `@cordisjs/plugin-hmr` does not run under Bun and fails fast with a clear
  error. Use the supervisor for development reload.
- The browser export of logger-console and the `create-cordis` scaffolder
  are untested under Bun (classified 🟡/⬜ above).
- The Bun behavioral suite uses real timers; timing assertions carry wide
  margins. The Node suite remains the source of truth for fake-timer
  precision cases.
