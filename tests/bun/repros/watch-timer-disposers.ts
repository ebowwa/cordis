// Repro: bun --watch removes previous evaluations' pending timers without
// running their clear callbacks.
// Run: bun --watch tests/bun/repros/watch-timer-disposers.ts
// Then append comment lines and watch tick density vs "cleared" output.
const gen = (globalThis as any).__GEN__ = ((globalThis as any).__GEN__ ?? 0) + 1
console.log(`[repro] eval #${gen} (globalThis.__GEN__ resets each reload)`)
setInterval(() => console.log(`[repro] tick from eval #${gen}`), 300)
// the disposer below never runs on reload — Bun drops the raw timer.
// Under --watch exactly ONE handler fires (the current generation's — old
// handlers are gone with the reset state; see
// signal-handler-accumulation.ts for the --hot contrast).
process.on('SIGINT', () => {
  console.log(`[repro] SIGINT: handled once, by the CURRENT generation's handler`)
  process.exit(0)
})
