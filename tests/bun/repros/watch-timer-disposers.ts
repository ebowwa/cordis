// Repro: bun --watch removes previous evaluations' pending timers without
// running their clear callbacks.
// Run: bun --watch tests/bun/repros/watch-timer-disposers.ts
// Then append comment lines and watch tick density vs "cleared" output.
const gen = (globalThis as any).__GEN__ = ((globalThis as any).__GEN__ ?? 0) + 1
console.log(`[repro] eval #${gen} (globalThis.__GEN__ resets each reload)`)
setInterval(() => console.log(`[repro] tick from eval #${gen}`), 300)
// the disposer below never runs on reload — Bun drops the raw timer
process.on('SIGINT', () => {
  console.log(`[repro] SIGINT: only signal handlers from OLD evaluations may still run`)
  process.exit(0)
})
