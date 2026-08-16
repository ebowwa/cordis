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

Observed (1.3.14): same pid every reload; module re-evaluates; both
`globalThis` and `process` custom properties are **reset to fresh values**
on every reload — so a re-evaluated entry cannot reach the previous
Cordis root context.

## watch-timer-disposers.ts

Demonstrates that pending timers from previous evaluations disappear on
reload **without their clearing callbacks running**:

```
bun --watch tests/bun/repros/watch-timer-disposers.ts
# append comment lines between observations
```

Observed: tick density stays constant (no timer stacking — Bun removes old
timers), but the `clearInterval` disposer closure never runs (no
"cleared" output on reload).

## hot-state-duplication.ts

Demonstrates `bun --hot` duplicating live state across re-evaluations:

```
bun --hot tests/bun/repros/hot-state-duplication.ts
# then edit the marker string in the file and save
```

Observed: after an edit, output lines from BOTH the old and the new
evaluation interleave forever (old timers/listeners keep running) — Cordis
state would duplicate on every reload.

These behaviors motivated the supervisor design
(`packages/core/bin.bun.watch.js`) instead of relying on `--watch`/`--hot`
for Cordis development reload.
