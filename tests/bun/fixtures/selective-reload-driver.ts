// Driver for tests/bun/selective-reload.spec.ts — run by a Bun build that
// includes oven-sh/bun#39426 (file:// query in module keys).
// Prints a tagged transcript; the spec asserts on its ordering.
import { Context } from 'cordis'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN = [
  'const gen = (globalThis as any).__gen = ((globalThis as any).__gen ?? 0) + 1',
  'export const captured = (globalThis as any).__token',
  'export function apply(ctx: any) {',
  '  console.log(`[plugin] apply gen=${gen} captured=${captured}`)',
  '  ctx.effect(() => {',
  '    const t = setInterval(() => console.log(`[plugin] tick gen=${gen}`), 150)',
  '    return () => { clearInterval(t); console.log(`[plugin] disposed gen=${gen}`) }',
  '  })',
  '}',
].join('\n')

const dir = await mkdtemp(join(tmpdir(), 'sel-plugin-'))
await writeFile(join(dir, 'plugin.ts'), PLUGIN)

const pluginURL = pathToFileURL(join(dir, 'plugin.ts')).href
const root = new Context()

// root-owned effect: must survive the plugin swap, unduplicated
root.effect(() => {
  const t = setInterval(() => console.log('[resident] tick'), 150)
  return () => { clearInterval(t); console.log('[resident] disposed') }
})

async function loadGeneration(n: number) {
  // requires bun#39426: each ?gen=N is a fresh module instance
  const mod = await import(`${pluginURL}?gen=${n}`)
  return root.plugin(mod)
}

const gen1 = await loadGeneration(1)
await new Promise(r => setTimeout(r, 400))
console.log('--- swap ---')
;(globalThis as any).__token = 'reloaded'
const gen2 = await loadGeneration(2)
await gen1.dispose()
await new Promise(r => setTimeout(r, 400))
console.log('--- shutdown ---')
await gen2.dispose()
await root.fiber.dispose()
process.exit(0)
