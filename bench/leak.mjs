/**
 * Memory-leak check: many plugin load/dispose cycles, then verify the event
 * hook registry and plugin registry return to empty and measure rss growth.
 */
import { Context } from 'cordis'

const CYCLES = 600

function gc() {
  if (typeof Bun !== 'undefined') Bun.gc(false)
  else if (globalThis.gc) globalThis.gc()
}

function snapshot(label) {
  gc(); gc()
  const m = process.memoryUsage()
  return { label, rss: m.rss, heapUsed: m.heapUsed ?? 0 }
}

const root = new Context()
const plugin = ctx => {
  ctx.on('bench-event', () => {})
  ctx.on('bench-event', () => {})
  ctx.effect(() => {
    const t = setInterval(() => {}, 1 << 28)
    return () => clearInterval(t)
  })
  ctx.effect(() => () => {})
}

// warmup
for (let i = 0; i < 50; i++) {
  const f = await root.plugin(plugin)
  await f.dispose()
}
await sleep(5)

const before = snapshot('before')
for (let i = 0; i < CYCLES; i++) {
  const f = await root.plugin(plugin)
  await f.dispose()
}
await sleep(5)
const after = snapshot('after')

const hooks = Object.entries(root.events._hooks)
  .filter(([, v]) => v.length)
const report = {
  runtime: typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.version,
  cycles: CYCLES,
  rssBefore: before.rss,
  rssAfter: after.rss,
  rssGrowthMB: +((after.rss - before.rss) / 1048576).toFixed(2),
  heapGrowthMB: +((after.heapUsed - before.heapUsed) / 1048576).toFixed(2),
  registryEmpty: root.registry.size === 0,
  leftoverHooks: hooks.map(([k, v]) => `${k}:${v.length}`),
}

console.log('@@LEAK ' + JSON.stringify(report))

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
