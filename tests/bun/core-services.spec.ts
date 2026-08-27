import { describe, it, expect } from 'bun:test'
import { Context, Service } from 'cordis'
import { spy, sleep } from './helpers'

describe('Bun / core: provide/inject', () => {
  it('inject activation is deferred until the service is ready', async () => {
    class Foo extends Service {
      constructor(ctx: Context) {
        super(ctx, 'foo')
      }

      async [Service.init]() {
        await new Promise<void>(resolve => {
          this.ctx.on('custom-event', resolve)
        })
      }
    }

    const root = new Context()
    const callback = spy(() => {})
    root.inject(['foo'], callback)
    expect(callback.calls.length).toBe(0)

    root.plugin(Foo)
    await sleep()
    expect(callback.calls.length).toBe(0) // blocked by Service.init

    root.emit('custom-event')
    await sleep()
    expect(callback.calls.length).toBe(1)
  })

  it('inject blocks while dependency is absent and activates when provided', async () => {
    const root = new Context()
    const callback = spy(() => {})

    const fiber = root.inject(['foo'], callback)
    await sleep()
    expect(callback.calls.length).toBe(0)
    expect(fiber.state).not.toBe('active' as any)

    const dispose = root.provide('foo', { bar: 1 })
    await sleep()
    expect(callback.calls.length).toBe(1)
    expect(root.foo).toEqual({ bar: 1 })

    // dependency removal deactivates the injector
    dispose()
    await sleep()
    expect(root.foo).toBeUndefined()
  })

  it('dependency removal and reactivation preserves callback semantics', async () => {
    const root = new Context()
    const events: string[] = []

    root.inject(['foo'], (ctx) => {
      events.push('start')
      return () => events.push('stop')
    })

    const d1 = root.provide('foo', 1)
    await sleep()
    expect(events).toEqual(['start'])

    d1()
    await sleep()
    expect(events).toEqual(['start', 'stop'])

    const d2 = root.provide('foo', 2)
    await sleep()
    expect(events).toEqual(['start', 'stop', 'start'])

    d2()
    await sleep()
    expect(events).toEqual(['start', 'stop', 'start', 'stop'])
  })

  it('provider replacement restarts injectors with the new value', async () => {
    const root = new Context()
    const seen: any[] = []
    root.inject(['foo'], (ctx) => {
      seen.push(ctx.foo)
    })

    const d1 = root.provide('foo', 'a')
    await sleep()
    d1()
    const d2 = root.provide('foo', 'b')
    await sleep()
    d2()

    expect(seen).toEqual(['a', 'b'])
    expect(root.foo).toBeUndefined()
  })

  it('multiple chained injects activate in dependency order', async () => {
    const foo = spy(() => {})
    const bar = spy(() => {})
    const qux = spy(() => {})

    class Foo extends Service {
      static inject = ['qux']
      constructor(ctx: Context) {
        super(ctx, 'foo')
      }
      [Service.init] = foo
    }

    class Bar extends Service {
      static inject = ['foo', 'qux']
      constructor(ctx: Context) {
        super(ctx, 'bar')
      }
      [Service.init] = bar
    }

    class Qux extends Service {
      constructor(ctx: Context) {
        super(ctx, 'qux')
      }
      [Service.init] = qux
    }

    const root = new Context()
    await root.plugin(Foo)
    await root.plugin(Bar)
    await root.plugin(Qux)
    await sleep()

    expect(foo.calls.length).toBe(1)
    expect(bar.calls.length).toBe(1)
    expect(qux.calls.length).toBe(1)
  })
})
