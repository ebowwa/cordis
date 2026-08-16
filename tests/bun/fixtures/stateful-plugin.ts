import { Context } from 'cordis'

/**
 * Module-level state survives plugin reloads within one process (import
 * cache), which is exactly what makes listener/timer duplication detectable:
 * if an old listener or timer survived a dispose cycle, the counters would
 * grow faster than the number of applies.
 */
export const state = {
  applies: 0,
  hits: 0,
  ticks: 0,
  lastConfig: undefined as any,
}

export function apply(ctx: Context, config: any) {
  state.applies++
  state.lastConfig = config
  ctx.on('test/get-value', () => state.applies)
  ctx.on('test/ping', () => { state.hits++ })
  ctx.effect(() => {
    const timer = setInterval(() => { state.ticks++ }, 15)
    return () => clearInterval(timer)
  })
}
