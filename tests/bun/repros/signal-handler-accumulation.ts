// Repro: signal handlers accumulate under `bun --hot` but NOT under
// `bun --watch` (Bun 1.3.14) — --hot is the in-process soft reload that
// preserves globalThis, --watch is a hard restart.
// Run:   bun --hot   tests/bun/repros/signal-handler-accumulation.ts
//   or:  bun --watch tests/bun/repros/signal-handler-accumulation.ts
// Then append a comment line to this file twice, and send the signal:
//   kill -USR2 <pid>
const gen = (globalThis as any).__gen = ((globalThis as any).__gen ?? 0) + 1
process.on('SIGUSR2', () => console.log(`[repro] sigusr2 handled by gen=${gen}`))
console.log(`[repro] eval gen=${gen} pid=${process.pid} sigusr2-listeners=${process.listenerCount('SIGUSR2')}`)
setInterval(() => {}, 1000)
// Observed on 1.3.14 after two edits (three generations):
//   --watch: eval gen resets to 1 each reload (globalThis fresh); the signal
//            fires ONE handler.
//   --hot:   eval gen increments 1 -> 2 -> 3 (globalThis survives); the
//            signal fires THREE handlers — one per generation. This is the
//            leak oven-sh/bun#32856 gives user code the hook to clean up.
