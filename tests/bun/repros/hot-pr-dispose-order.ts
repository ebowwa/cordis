// Repro: oven-sh/bun#32856 (import.meta.hot for bun --hot) — dispose runs
// BEFORE re-evaluation, and hot.data persists across reloads.
// Run: bun-32856 --hot tests/bun/repros/hot-pr-dispose-order.ts
// (bun-32856 is installed by `bunx bun-pr 32856`; on stock Bun
// import.meta.hot is undefined and this only prints the eval line.)
// Then append a comment line to this file (content-hash watch) a few times.
const gen = (globalThis as any).__gen = ((globalThis as any).__gen ?? 0) + 1
const hot = (import.meta as any).hot
console.log(`[repro] eval gen=${gen} hot=${hot ? 'object' : String(hot)} data=${hot ? JSON.stringify(hot.data) : '-'}`)
if (hot) {
  hot.data.gen = gen
  hot.dispose(() => {
    console.log(`[repro] dispose gen=${gen} data=${JSON.stringify(hot.data)}`)
  })
}
setInterval(() => console.log(`[repro] tick gen=${gen}`), 250)
// Observed on the PR build (bun-1.4.0-pr32856, Aug 13 2026 artifact):
//   eval gen=1 ... tick gen=1 ...
//   dispose gen=1 data={"gen":1}      <- before the next eval, awaited
//   eval gen=2 data={"gen":1}         <- hot.data survived the reload
//   tick gen=1 / tick gen=2 ...       <- old timer still runs: the dispose
//                                       callback must clean it up (Cordis
//                                       does this via root-fiber disposal;
//                                       see packages/core/bin.bun.js)
