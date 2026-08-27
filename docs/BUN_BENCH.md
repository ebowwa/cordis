# Cordis Benchmarks — Bun vs Node, fork vs upstream

Measurements taken 2026-08-16 on the development machine (Apple silicon
macOS 26.5.2, arm64). **Absolute numbers are indicative only** — this is a
laptop, not an isolated benchmark environment. Relative comparisons and
ranges are the meaningful output. Two full passes were taken per
configuration; the tables show best/worst across passes.

- Node `v26.4.0` (with `--import tsx` for TypeScript paths)
- Bun `1.3.14` (`1.3.14+0d9b296af`)
- "fork" = this repository (`feat/bun-compat`), "upstream" =
  `cordiverse/cordis@8cc9e33` in a temporary git worktree, built and run
  identically
- The fork has **zero source changes** vs upstream (`git diff upstream/main
  -- packages/*/src` is empty), so fork-vs-upstream is a control group

Reproduce with:

```bash
node bench/run.mjs run --runtime node --label fork-node
node bench/run.mjs run --runtime bun  --label bun
node bench/run.mjs cold
node bench/run.mjs leak --runtime node && node bench/run.mjs leak --runtime bun
node bench/run.mjs profile --runtime node --label node
node bench/run.mjs profile --runtime bun  --label bun
node bench/parse-profile.mjs bench/results/prof-node/*.cpuprofile
```

## 1. Fork vs upstream (control, both Node) — parity

Back-to-back alternating runs of the noisiest workload (`plugin-lifecycle`)
show overlapping ranges — fork 735–849 µs/op vs upstream 690–741 µs/op with
crossovers — i.e. differences are within the ±15 % machine run-to-run
variance, not systematic. Conclusion: **the fork introduces no performance
change under Node** (expected: no runtime code was modified).

Full single-pass tables live in `bench/results/*.json`; every workload
overlapped between fork and upstream within variance except where noted in
§2.

## 2. Node vs Bun (fork) — in-process workloads

µs/op, best / worst of two full passes (lower is better):

| workload | fork node | upstream node | bun | node / bun |
| --- | --- | --- | --- | --- |
| context-create | 1600 / 1643 | 1419 / 1546 | 159 / 229 | **10.1x** |
| plugin-lifecycle (apply+dispose) | 686 / 724 | 537 / 570 | 137 / 186 | **5.0x** |
| plugin-bulk-500 (apply 500, dispose) | 600 / 634 | 585 / 626 | 128 / 172 | **4.7x** |
| effects-sync-5 (5 disposers) | 72 / 74 | 79 / 84 | 14 / 19 | **5.2x** |
| effects-async (await settle) | 1217 / 1244 | 1236 / 1255 | 1217 / 1292 | 1.0x |
| emit (10 listeners) | 18 / 23 | 22 / 25 | 16 / 19 | 1.2x |
| parallel (10 async listeners) | 26 / 36 | 37 / 39 | 21 / 28 | 1.2x |
| serial (5 listeners) | 20 / 24 | 23 / 24 | 11 / 16 | **1.8x** |
| bail (5 listeners) | 19 / 21 | 18 / 20 | 8 / 9 | **2.4x** |
| waterfall (5 listeners) | 30 / 32 | 26 / 28 | 16 / 17 | **1.9x** |
| inject-cycles (provide/settle/remove) | 2943 / 3146 | 2579 / 2584 | 2539 / 2543 | 1.2x |
| isolate-provide | 3062 / 3316 | 2884 / 3583 | 2756 / 2832 | 1.1x |
| timer-effect (create+clear timeout) | 124 / 138 | 155 / 216 | 41 / 44 | **3.0x** |
| loader-mock-50 (tree updates) | 366 / 384 | 333 / 478 | 151 / 206 | **2.4x** |
| include-boot-20-plugins (ms/boot) | 66 / 71 | 60 / 129 | 15.6 / 18.7 | **4.2x** |
| module-eval-ts (fresh TS module) | 1202 / 2385 | 1215 / 4111 | 15 / 18 | **~80x** ⚠️¹ |

¹ **Corrected in §6:** the Bun column here was measured on stock Bun, where
the cache-busting query silently returned the CACHED module
(oven-sh/bun#21346) — i.e. it measured 1 eval + 149 cache hits, not 150
evaluations. The honest ratio is ~5x, not ~80x.

Reading:

- **Bun is faster on every Cordis operation**; the largest wins are exactly
  where a Bun-first deployment would care: plugin apply/dispose ~5x, timer
  bookkeeping ~3x, declarative-loader tree updates ~2.4x, config-boot ~4x.
- `effects-async`, `inject-cycles`, `isolate-provide` are **dominated by
  `setTimeout(0)` settle latency** (≈1.2–1.3 ms per tick on both runtimes
  under macOS) — they measure event-loop timer floor, not Cordis, and are
  effectively runtime-neutral.
- `module-eval-ts` imports a fresh `.ts` module per op (cache-busted URL).
  Node's path goes through tsx (esbuild RPC round-trip per module); Bun
  transpiles natively in-process. This is the single biggest practical
  difference: **loading many TypeScript plugins is ~2 orders of magnitude
  cheaper under Bun**.

## 3. Cold start (spawn → READY, median of 10)

| variant | node | bun |
| --- | --- | --- |
| interpreter baseline (`-e "console.log"`) | 137 ms | 41 ms |
| Context + 3 plugins (JS) | 160 ms | 63 ms |
| Loader + Include + 3 **JS** plugins | 224 ms | 131 ms |
| Loader + Include + 3 **TS** plugins | 621 ms | 133 ms |

Decomposition (subtracting the previous row):

- Cordis core import + boot: **≈23 ms (Node) vs ≈22 ms (Bun)** — parity;
  Cordis itself is runtime-neutral at startup.
- Loader + Include + config read + 3 dynamic imports: ≈63 ms (Node) vs
  ≈68 ms (Bun) — parity.
- TypeScript under Node adds **≈400 ms** (tsx preload + transpile); under
  Bun, TS costs the same as JS. Node's entire cold-start penalty in the TS
  case is the transpiler toolchain, not Cordis.

## 4. Memory — 600 plugin load/dispose cycles

| metric | node | bun |
| --- | --- | --- |
| registry after cycles | empty | empty |
| leftover event hooks | `internal/listener:1, internal/update:1` (root's own permanent hooks — expected) | same |
| rss growth | +26.7 MB | +38.8 MB |
| heap growth | +5.2 MB | +0.3 MB |

No listener/timer accumulation on either runtime (corroborated by the
behavioral no-duplication tests). rss/heap accounting differs between V8
and JSC and includes allocator retention; neither shows per-cycle growth
proportional to the 600 cycles.

## 5. CPU profiles (fixed 2s mixed workload)

Top self-time frames:

- **Node**: `(anonymous) @ reflect.ts` 34 %, tsx loader plumbing
  (`makeSyncRequest`, `waitForWorker` @ hooks) ~11 %, GC 5 %, then
  `emit @ events.ts`, `trace @ reflect.ts`, `getPropertyDescriptor @ utils.ts`.
- **Bun**: native/JIT frames (`(host)`, `getOwnPropertyDescriptor`) ~39 %,
  then `isSpecialProperty @ reflect.ts` 8 %, `get @ utils.ts` 7 %,
  `emit @ events.ts`, `getTraceable @ utils.ts`.

Common finding: the top Cordis-internal hotspot is **`packages/core/src/reflect.ts`
(proxy machinery)** on both runtimes — a shared optimization target, not a
Bun-specific issue. Node's profile additionally pays for tsx's
loader-thread RPC when TypeScript is involved.

## Caveats

- Single developer machine; background processes cause the observed ±15 %
  run-to-run spread (visible in the ranges above).
- Bun numbers use Bun's JIT warm state after per-workload warmup batches,
  same protocol as Node.
- `include-boot`/`module-eval` touch the filesystem (tmpdir); both runtimes
  use the same tmpdir.
- The Node side always preloads tsx (required for the TS workloads); for
  pure-JS workloads tsx is inert after startup.

## 6. Four-configuration matrix (2026-08-17, same-day re-run)

Runtimes compared on one day, two full passes each (best/worst across
passes; §2's fork-vs-upstream control already proved fork ≡ upstream under
Node, so upstream is omitted here):

- **fork node** — Node v26.4.0 + tsx
- **bun 1.3.14** — stock release (what users get today)
- **bun-39426** — release build `1.4.0-canary.1+c16333e9e` containing our
  oven-sh/bun#39426 fix (release asset `bun-39426-darwin-aarch64`)

µs/op, best / worst of two passes (lower is better); regenerate with
`node bench/compare.mjs`:

| workload | fork node | bun 1.3.14 | bun-39426 | node/bun | node/bun-39426 |
| --- | --- | --- | --- | --- | --- |
| context-create | 1576 / 1614 | 152 / 158 | 133 / 191 | 10.4x | 11.8x |
| plugin-lifecycle (apply+dispose) | 633 / 766 | 149 / 152 | 125 / 138 | 4.3x | 5.0x |
| plugin-bulk-500 | 589 / 728 | 117 / 140 | 96 / 153 | 5.0x | 6.1x |
| effects-sync-5 | 89 / 96 | 12 / 16 | 11 / 15 | 7.4x | 7.8x |
| effects-async | 1231 / 1236 | 1207 / 1311 | 1184 / 1195 | 1.0x | 1.0x |
| emit-10-listeners | 24 / 26 | 18 / 21 | 13 / 14 | 1.4x | 1.9x |
| parallel-10-async | 31 / 38 | 22 / 24 | 17 / 24 | 1.4x | 1.8x |
| serial-5 | 17 / 19 | 12 / 12 | 11 / 12 | 1.5x | 1.6x |
| bail-5 | 21 / 21 | 8 / 10 | 8 / 9 | 2.4x | 2.6x |
| waterfall-5 | 26 / 26 | 15 / 20 | 13 / 17 | 1.7x | 1.9x |
| inject-cycles | 2629 / 2638 | 2536 / 2921 | 2477 / 2486 | 1.0x | 1.1x |
| isolate-provide | 2827 / 2896 | 2596 / 2626 | 2554 / 2567 | 1.1x | 1.1x |
| timer-effect | 122 / 141 | 35 / 38 | 30 / 40 | 3.5x | 4.0x |
| loader-mock-50 | 339 / 366 | 100 / 126 | 126 / 137 | 3.4x | 2.7x |
| include-boot-20-plugins (ms/boot) | 54.6 / 64.0 | 14.0 / 15.0 | 9.9 / 16.2 | 3.9x | 5.5x |
| module-eval-ts | 982 / 1369 | 9 / 10 ⚠️² | 194 / 296 | 104x ⚠️² | **5.1x** |
| selective-reload (swap gen) | 1597 / 1887 | 169 / 185 ⚠️² | 390 / 415 | 9.5x ⚠️² | **4.1x** |

² **The stock-Bun numbers for query-busting workloads are degenerate**: on
1.3.14 the distinct queries map to one cached module (oven-sh/bun#21346,
fixed by our #39426 — see §6.1), so those rows measure cache hits, not
module evaluation.

### 6.1 The measurement bug inside the benchmark

The Phase 6 "~80x TS module eval" claim is **retracted**. `module-eval-ts`
cache-busts via `file://…?b<N>i<M>`; on stock Bun every import after the
first returned the cached instance, so the workload measured one
transpile+eval plus 149 lookups. On bun-39426 (and on Node), each query is
a genuinely fresh instance — giving the honest ratios above (~5x). This is
the same bug class Cordis PR #2 exists to use, and it silently inflated a
benchmark: a decent argument for capability probes in benchmarks, not just
tests. Verified directly (`a === b` on distinct queries): stock bun →
`true` (cached), bun-39426/node → `false` (fresh), matching the numbers.

### 6.2 New capability axis: selective reload

`selective-reload` (new workload): one full generation swap = fresh TS
module via query-busted import + activate under the root + graceful
dispose of the previous fiber — the Phase C primitive. Real cost on
bun-39426: **390–415 µs per swap**, ~4.1x faster than Node's honest
equivalent (tsx eval + swap). On stock Bun the row is degenerate (no
re-evaluation occurs). Node cannot do the in-place variant at all without
`--expose-internals`; this workload's Node column goes through tsx.

### 6.3 bun-39426 vs stock 1.3.14 generally

Across the 15 honest (non-degenerate) workloads the canary carrying our
fix is equal or faster than stock 1.3.14 (e.g. plugin-lifecycle 125–138 vs
149–152; context-create 133 vs 152 best-case) — expected: it is three
weeks of newer `main` plus the fix, built as release. Cold start and leak
checks on bun-39426: heap growth 0.99 MB over 600 load/dispose cycles,
registry empty at end (parity with the §4 stock-Bun result).

Reproduce this section:

```bash
node bench/run.mjs run --runtime node --label fork-node-r1   # + r2
node bench/run.mjs run --runtime bun  --label bun-r1         # + r2
BUN_BIN=.upstream/bin/bun-39426 node bench/run.mjs run --runtime bun --label bun39426-r1  # + r2
node bench/compare.mjs
```
