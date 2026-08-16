/**
 * Process-shutdown fixture: boots a real Loader + Include + plugin with
 * listeners and timers, then on SIGINT performs a complete root-fiber
 * disposal before exiting cleanly.
 *
 * Output contract (parsed by shutdown.spec.ts):
 *   ready
 *   events:[...]
 *   registry:<n>
 *   exit:0
 */
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'

const ctx = new Context()
ctx.baseUrl = new URL('.', import.meta.url).href

const events: string[] = []

await ctx.plugin(Loader)

await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: {
    path: './app.yml',
    enableLogs: false,
  },
})

// a plugin with nested children, listeners and a live interval
await ctx.plugin(function outer(ctx: Context) {
  ctx.on('custom-event', () => {})
  ctx.effect(() => {
    const timer = setInterval(() => {}, 10)
    return () => {
      clearInterval(timer)
      events.push('outer-stop')
    }
  })
  ctx.plugin((ctx2) => {
    ctx2.on('custom-event', () => {})
    ctx2.effect(() => {
      const timer = setInterval(() => {}, 10)
      return () => {
        clearInterval(timer)
        events.push('inner-stop')
      }
    })
  })
})

process.on('SIGINT', async () => {
  try {
    await ctx.fiber.dispose()
  } catch (error) {
    console.log('dispose-error:' + (error as Error).message)
    process.exit(1)
  }
  console.log('events:' + JSON.stringify(events))
  console.log('registry:' + ctx.registry.size)
  process.exit(0)
})

console.log('ready')
