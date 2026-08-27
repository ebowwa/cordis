import { describe, it, expect } from 'bun:test'
import { Context, Service } from 'cordis'
import { spy, sleep, event } from './helpers'

describe('Bun / core: isolation', () => {
  it('isolated contexts see distinct service instances', async () => {
    const root = new Context()
    const callback = spy(() => {})
    const dispose = spy(() => {})
    const plugin = {
      inject: ['foo'],
      apply: (ctx: Context) => {
        callback()
        return dispose
      },
    }

    await root.plugin(plugin)
    const ctx1 = root.isolate('foo')
    await ctx1.plugin(plugin)
    const ctx2 = root.isolate('foo')
    await ctx2.plugin(plugin)

    const dispose0 = root.provide('foo', { bar: 100 })
    expect((root as any).foo).toEqual({ bar: 100 })
    expect((ctx1 as any).foo).toBeUndefined()
    expect((ctx2 as any).foo).toBeUndefined()
    await sleep()
    expect(callback.calls.length).toBe(1)
    expect(dispose.calls.length).toBe(0)

    const dispose1 = ctx1.provide('foo', { bar: 200 })
    expect((root as any).foo).toEqual({ bar: 100 })
    expect((ctx1 as any).foo).toEqual({ bar: 200 })
    expect((ctx2 as any).foo).toBeUndefined()
    await sleep()
    expect(callback.calls.length).toBe(2)
    expect(dispose.calls.length).toBe(0)

    dispose0()
    expect((root as any).foo).toBeUndefined()
    expect((ctx1 as any).foo).toEqual({ bar: 200 })
    await sleep()
    expect(callback.calls.length).toBe(2)
    expect(dispose.calls.length).toBe(1)

    const dispose2 = ctx2.provide('foo', { bar: 300 })
    expect((ctx2 as any).foo).toEqual({ bar: 300 })
    await sleep()
    expect(callback.calls.length).toBe(3)
    expect(dispose.calls.length).toBe(1)
    dispose2()
  })

  it('contexts sharing an isolation label share the service', async () => {
    const root = new Context()
    const callback = spy(() => {})
    const dispose = spy(() => {})
    const plugin = {
      inject: ['foo'],
      apply: (ctx: Context) => {
        callback()
        return dispose
      },
    }

    const label = Symbol('test')
    await root.plugin(plugin)
    const ctx1 = root.isolate('foo', label)
    await ctx1.plugin(plugin)
    const ctx2 = root.isolate('foo', label)
    await ctx2.plugin(plugin)
    await sleep()
    expect(callback.calls.length).toBe(0)

    const dispose0 = root.provide('foo', { bar: 100 })
    expect((ctx1 as any).foo).toBeUndefined()
    await sleep()
    expect(callback.calls.length).toBe(1)

    const dispose12 = ctx1.provide('foo', { bar: 200 })
    expect((ctx1 as any).foo).toEqual({ bar: 200 })
    expect((ctx2 as any).foo).toEqual({ bar: 200 })
    await sleep()
    expect(callback.calls.length).toBe(3)
    expect(dispose.calls.length).toBe(0)

    dispose12()
    expect((ctx1 as any).foo).toBeUndefined()
    await sleep()
    expect(callback.calls.length).toBe(3)
    expect(dispose.calls.length).toBe(2)
    dispose0()
  })

  it('events emitted from an isolated service reach only matching listeners', async () => {
    class Foo extends Service {
      constructor(ctx: Context) {
        super(ctx, 'foo')
        this.ctx.emit(this, event)
      }
    }

    const root = new Context()
    const ctx = root.isolate('foo')
    const outer = spy(() => {})
    const inner = spy(() => {})
    root.on(event, outer)
    ctx.on(event, inner)
    await ctx.plugin(Foo)

    expect(outer.calls.length).toBe(0)
    expect(inner.calls.length).toBe(1)
  })
})
