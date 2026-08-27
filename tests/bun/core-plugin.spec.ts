import { describe, it, expect } from 'bun:test'
import { Context, Service } from 'cordis'
import { spy, event } from './helpers'

describe('Bun / core: plugins', () => {
  it('function plugin receives context and config', async () => {
    const root = new Context()
    let received: any
    const callback = spy((ctx: Context, config: any) => {
      received = config
      // note: a plugin's return value is treated as an effect, so this
      // deliberately returns undefined
    })
    const options = { foo: 'bar' }
    await root.plugin(callback, options)
    expect(callback.calls.length).toBe(1)
    expect(received).toEqual(options)
  })

  it('object plugin (apply method)', async () => {
    const root = new Context()
    const callback = spy(() => {})
    const options = { bar: 'foo' }
    await root.plugin({ apply: callback }, options)
    expect(callback.calls.length).toBe(1)
    expect(callback.calls[0][1]).toEqual(options)
  })

  it('class plugin is constructed with context and config', async () => {
    const root = new Context()
    const options = { baz: 1 }
    let received: any
    class Klass {
      constructor(ctx: Context, config: any) {
        received = { ctx, config }
      }
    }
    await root.plugin(Klass, options)
    expect(received.config).toEqual(options)
    expect(Context.is(received.ctx)).toBe(true)
  })

  it('named plugin appears in fiber name', async () => {
    const root = new Context()
    await root.plugin(function foo(ctx: Context) {
      expect(ctx.fiber.name).toBe('foo')
    })
    await root.plugin({
      name: 'bar',
      apply(ctx: Context) {
        expect(ctx.fiber.name).toBe('bar')
      },
    })
  })

  it('invalid plugins are rejected', () => {
    const root = new Context()
    expect(() => root.plugin(undefined as any)).toThrow()
    expect(() => root.plugin({} as any)).toThrow()
    expect(() => root.plugin({ apply: {} } as any)).toThrow()
  })

  it('nested plugins: listeners accumulate and are cleaned up together', async () => {
    const plugin = async (ctx: Context) => {
      ctx.on(event, callback)
      await ctx.plugin(async (ctx) => {
        ctx.on(event, callback)
        await ctx.plugin((ctx) => {
          ctx.on(event, callback)
        })
      })
    }

    const root = new Context()
    const callback = spy(() => {})
    root.on(event, callback)
    const fiber = await root.plugin(plugin)

    expect(root.registry.size).toBe(3)
    root.emit(event)
    expect(callback.calls.length).toBe(4)

    callback.reset()
    await fiber.dispose()
    expect(root.registry.size).toBe(0)
    root.emit(event)
    expect(callback.calls.length).toBe(1) // only the root-level listener

    callback.reset()
    await fiber.dispose() // idempotent
    root.emit(event)
    expect(callback.calls.length).toBe(1)
  })

  it('root dispose disposes everything and is idempotent', async () => {
    const root = new Context()
    const dispose = spy(() => {})
    const fiber = root.plugin(() => dispose)
    expect(root.fiber.uid).toBe(0)
    expect(fiber.uid).toBe(1)
    expect(dispose.calls.length).toBe(0)

    await root.fiber.dispose()
    expect(root.fiber.uid).toBe(0)
    expect(fiber.uid).toBe(null)
    expect(dispose.calls.length).toBe(1)

    await root.fiber.dispose()
    expect(dispose.calls.length).toBe(1)
  })

  it('Service.init hook runs on activation and its disposer on disposal', async () => {
    const start = spy(() => {})
    const stop = spy(() => {})

    class Foo {
      [Service.init]() {
        start()
        return stop
      }
    }

    const root = new Context()
    const fiber = await root.plugin(Foo)
    expect(start.calls.length).toBe(1)
    expect(stop.calls.length).toBe(0)
    await fiber.dispose()
    expect(start.calls.length).toBe(1)
    expect(stop.calls.length).toBe(1)
  })
})
