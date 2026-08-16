import { describe, it, expect } from 'bun:test'
import { Context } from 'cordis'
import Timer from '@cordisjs/plugin-timer'
import { spy, sleep } from './helpers'

// Real timers (bun:test has no fake timers); delays are short but the
// assertions use wide margins so scheduling jitter cannot flip them.

async function withContext(callback: (ctx: Context) => Promise<void> | void) {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin({ inject: ['timer'], apply: callback })
  return ctx
}

describe('Bun / timer service', () => {
  it('ctx.timeout() invokes once and never again', async () => {
    await withContext(async (ctx) => {
      const callback = spy(() => {})
      ctx.timeout(callback, 20)
      expect(callback.calls.length).toBe(0)
      await sleep(60)
      expect(callback.calls.length).toBe(1)
      await sleep(40)
      expect(callback.calls.length).toBe(1)
    })
  })

  it('ctx.timeout() dispose prevents the callback', async () => {
    await withContext(async (ctx) => {
      const callback = spy(() => {})
      const dispose = ctx.timeout(callback, 30)
      dispose()
      await sleep(80)
      expect(callback.calls.length).toBe(0)
    })
  })

  it('ctx.timeout() promise form resolves after the delay', async () => {
    await withContext(async (ctx) => {
      let resolved = false
      ctx.timeout(20).then(() => { resolved = true })
      expect(resolved).toBe(false)
      await sleep(60)
      expect(resolved).toBe(true)
    })
  })

  it('ctx.interval() ticks repeatedly and stops after dispose', async () => {
    await withContext(async (ctx) => {
      const callback = spy(() => {})
      const dispose = ctx.interval(callback, 20)
      await sleep(110)
      expect(callback.calls.length).toBeGreaterThanOrEqual(3)
      dispose()
      const count = callback.calls.length
      await sleep(80)
      expect(callback.calls.length).toBe(count)
    })
  })

  it('ctx.interval() async iterator completes on manual return', async () => {
    await withContext(async (ctx) => {
      const callback = spy(() => {})
      const iterator = ctx.interval(20)
      const done = spy(() => {})
      const failed = spy(() => {})
      ;(async () => {
        try {
          for await (const _ of iterator) callback()
        } catch {
          failed()
          return
        }
        done()
      })()
      await sleep(70)
      expect(callback.calls.length).toBeGreaterThanOrEqual(2)
      iterator.return!()
      await sleep(60)
      const count = callback.calls.length
      expect(done.calls.length).toBe(1)
      expect(failed.calls.length).toBe(0)
      await sleep(60)
      expect(callback.calls.length).toBe(count)
    })
  })

  it('ctx.interval() async iterator rejects on context disposal', async () => {
    const ctx = await withContext(async () => {})
    const callback = spy(() => {})
    const iterator = ctx.interval(20)
    const done = spy(() => {})
    const failed = spy(() => {})
    ;(async () => {
      try {
        for await (const _ of iterator) callback()
      } catch {
        failed()
        return
      }
      done()
    })()
    await sleep(60)
    expect(callback.calls.length).toBeGreaterThanOrEqual(1)
    await ctx.fiber.dispose()
    await sleep(60)
    const count = callback.calls.length
    expect(failed.calls.length).toBe(1)
    expect(done.calls.length).toBe(0)
    await sleep(60)
    expect(callback.calls.length).toBe(count)
  })

  it('ctx.throttle() leading + trailing execution', async () => {
    await withContext(async (ctx) => {
      const callback = spy(() => {})
      const throttled = ctx.throttle(callback, 50)
      throttled()
      expect(callback.calls.length).toBe(1)
      await sleep(20)
      throttled() // within window, schedules trailing
      expect(callback.calls.length).toBe(1)
      await sleep(60)
      expect(callback.calls.length).toBe(2)
      await sleep(100)
      expect(callback.calls.length).toBe(2)
    })
  })

  it('ctx.debounce() collapses repeated calls into one', async () => {
    await withContext(async (ctx) => {
      const callback = spy(() => {})
      const debounced = ctx.debounce(callback, 40)
      debounced()
      await sleep(20)
      debounced()
      await sleep(20)
      debounced()
      expect(callback.calls.length).toBe(0)
      await sleep(80)
      expect(callback.calls.length).toBe(1)
    })
  })

  it('disposing the context clears every pending timer', async () => {
    const ctx = await withContext(async () => {})
    const timeout = spy(() => {})
    const interval = spy(() => {})
    const debounced = spy(() => {})
    ctx.timeout(timeout, 2000)
    ctx.interval(interval, 2000)
    const d = ctx.debounce(debounced, 2000)
    d()
    await ctx.fiber.dispose()
    await sleep(60)
    expect(timeout.calls.length).toBe(0)
    expect(interval.calls.length).toBe(0)
    expect(debounced.calls.length).toBe(0)
  })
})
