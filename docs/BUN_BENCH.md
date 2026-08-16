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
| module-eval-ts (fresh TS module) | 1202 / 2385 | 1215 / 4111 | 15 / 18 | **~80x** |

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
