# Standalone Bun behavior reproductions

Manual scripts (not run by `bun test`) that document Bun 1.3.14 platform
behaviors the reload decision in `docs/BUN_COMPATIBILITY.md` is based on.
Each is self-contained; run it, edit the file as instructed, observe.

## watch-globals-reset.ts

Demonstrates `bun --watch` reload semantics:

```
bun --watch tests/bun/repros/watch-globals-reset.ts
# then append a comment line to the file (content-hash watch) a few times
```

Observed (1.3.14): the module re-evaluates and both `globalThis` and
`process` custom properties are **reset to fresh values** on every reload —
`--watch` is a **hard restart** (per Bun's docs), so a re-evaluated entry
cannot reach the previous Cordis root context. (On 1.3.14 the OS pid stays
the same — the restart happens in place — but that is an implementation
detail; no JS state survives it.)

## watch-timer-disposers.ts

Demonstrates that pending timers from previous evaluations disappear on
reload **without their clearing callbacks running**:

```
bun --watch tests/bun/repros/watch-timer-disposers.ts
# append comment lines between observations
```

Observed: tick density stays constant (no timer stacking — the restart
discards old timers), but the `clearInterval` disposer closure never runs
(no "cleared" output on reload).

## hot-state-duplication.ts

Demonstrates `bun --hot` duplicating live state across re-evaluations:

```
bun --hot tests/bun/repros/hot-state-duplication.ts
# then edit the marker string in the file and save
```

Observed: after an edit, output lines from BOTH the old and the new
evaluation interleave forever (old timers/listeners keep running) — Cordis
state would duplicate on every reload.

## signal-handler-accumulation.ts

Side-by-side proof that `--hot` preserves `globalThis` (handlers accumulate)
while `--watch` resets it (they do not):

```
bun --hot   tests/bun/repros/signal-handler-accumulation.ts   # or --watch
# append two comment lines, then: kill -USR2 <pid>
```

Observed (1.3.14): under `--hot` the generation counter increments and one
signal fires one handler **per generation** (three after two edits); under
`--watch` the counter resets and exactly one handler fires.

## hot-pr-dispose-order.ts

Demonstrates what oven-sh/bun#32856 (`import.meta.hot` for `bun --hot`)
changes — requires the PR build:

```
bunx bun-pr 32856
bun-32856 --hot tests/bun/repros/hot-pr-dispose-order.ts
# then append comment lines a few times
```

Observed (PR build, Aug 13 2026 artifact): `import.meta.hot` is an object;
`dispose` callbacks run — awaited — strictly **before** the module is
re-evaluated; `hot.data` persists across reloads. The old timer still ticks
until the dispose callback cleans it up, which is exactly the hook Cordis
uses (`packages/core/bin.bun.js` disposes the root fiber there).

These behaviors motivated the supervisor design
(`packages/core/bin.bun.watch.js`) for stock Bun, and the
`import.meta.hot`-driven in-process reload for Bun builds shipping bun#32856
(see `tests/bun/hot.spec.ts`).
