// Repro: bun --watch resets globalThis and process per reload.
// Run: bun --watch tests/bun/repros/watch-globals-reset.ts
// Then append a comment line to this file (touch alone does not trigger).
const runs = (globalThis as any).__RUNS__ = ((globalThis as any).__RUNS__ ?? 0) + 1
const processRuns = (process as any).__RUNS__ = ((process as any).__RUNS__ ?? 0) + 1
console.log(`[repro] pid=${process.pid} globalThis_runs=${runs} process_runs=${processRuns}`)
