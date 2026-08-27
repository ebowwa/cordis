/**
 * Fixed-duration mixed workload for CPU profiling
 * (`node --cpu-prof` / `bun --cpu-prof`). Runs ~2s of realistic Cordis work.
 */
import { Context } from 'cordis'

const DURATION_MS = 2000
const start = performance.now()

const emitRoot = new Context()
for (let i = 0; i < 10; i++) emitRoot.on('bench-event', () => {})

const pluginRoot = new Context()
const plugin = ctx => {
  ctx.on('bench-event', () => {})
  ctx.effect(() => () => {})
}

const injectRoot = new Context()
injectRoot.inject(['bench-svc'], () => {})

let rounds = 0
while (performance.now() - start < DURATION_MS) {
  for (let i = 0; i < 2000; i++) emitRoot.emit('bench-event')
  for (let i = 0; i < 30; i++) {
    const d = pluginRoot.effect(function* () {
      yield () => {}
      yield () => {}
      yield () => {}
    })
    d()
  }
  for (let i = 0; i < 10; i++) {
    const f = await pluginRoot.plugin(plugin)
    await f.dispose()
  }
  for (let i = 0; i < 10; i++) {
    const d = injectRoot.provide('bench-svc', i)
    await 0
    d()
    await 0
  }
  await Promise.resolve()
  rounds++
}
console.log('@@PROFILE rounds=' + rounds)
