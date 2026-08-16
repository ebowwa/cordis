// Repro: bun --hot keeps previous evaluations' timers running (state duplication).
// Run: bun --hot tests/bun/repros/hot-state-duplication.ts
// Then change the marker string below and save; observe interleaved output.
export let marker = 'v1'

console.log(`[repro] main evaluated, marker=${marker}`)
setInterval(() => console.log(`[repro] alive, marker=${marker}`), 400)
