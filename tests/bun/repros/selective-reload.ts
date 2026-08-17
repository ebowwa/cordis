// Selective plugin reload on Bun — the Phase C primitive, enabled by
// oven-sh/bun#39426 (a file:// URL's query is part of the module key).
// Run with a Bun that includes the fix:
//   ~/Developer/bun/build/release/bun tests/bun/repros/selective-reload.ts
//
// What this proves, per line of output:
//  - [resident] ticks continue across the reload, unduplicated  → root untouched
//  - gen=2's module is a FRESH instance (captured=reloaded)     → query busting
//  - gen=1's disposer ran and its timer stopped                 → graceful swap
//  - everything happens in-process, no restart
import { Context } from 'cordis'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = await mkdtemp(join(tmpdir(), 'cordis-selective-'))
await writeFile(join(dir, 'plugin.ts'), `
const gen = (globalThis as any).__gen = ((globalThis as any).__gen ?? 0) + 1
export const captured = (globalThis as any).__token
export function apply(ctx: any) {
  console.log(\`[plugin] apply gen=\${gen} captured=\${captured}\`)
  ctx.effect(() => {
    const t = setInterval(() => console.log(\`[plugin] tick gen=\${gen}\`), 150)
    return () => { clearInterval(t); console.log(\`[plugin] disposed gen=\${gen}\`) }
  })
}
`)

const pluginURL = pathToFileURL(join(dir, 'plugin.ts')).href
const root = new Context()

// resident plugin: must keep ticking, exactly once, across the reload
root.effect(() => {
  const t = setInterval(() => console.log('[resident] tick'), 150)
  return () => { clearInterval(t); console.log('[resident] disposed') }
})

async function loadGeneration(n: number) {
  // query-busting: each ?gen=N is a FRESH module instance (needs #39426)
  const mod = await import(`${pluginURL}?gen=${n}`)
  return root.plugin(mod)
}

const gen1 = await loadGeneration(1)
await new Promise(r => setTimeout(r, 400))

console.log('--- selective reload: swap the plugin, keep the root ---')
;(globalThis as any).__token = 'reloaded'
const gen2 = await loadGeneration(2)   // new instance + activate
await gen1.dispose()                   // graceful: old timer cleared, disposer ran
await new Promise(r => setTimeout(r, 400))

console.log('--- shutdown ---')
await gen2.dispose()
await root.fiber.dispose()
