import { describe, it, expect, beforeAll } from 'bun:test'
import { Context, FiberState, Plugin } from 'cordis'
import { Dict } from 'cosmokit'
import { EntryOptions, Group, Loader } from '@cordisjs/plugin-loader'
import { spy, sleep } from './helpers'

type Wrapped = { apply: (...args: any[]) => any }

class MockLoader extends Loader {
  public data: EntryOptions[] = []
  public modules: Dict<Wrapped> = Object.create(null)

  constructor(ctx: Context) {
    super(ctx)
    ctx.on('internal/get', (ctx, prop, error, next) => {
      if (!ctx.fiber.runtime && prop === 'loader') {
        return ctx.get(prop)
      }
      return next()
    })
  }

  write() {
    this.data = this.root.data
  }

  async read(data: any) {
    this.data = data
    await this.root.update(data)
    await this.await()
  }

  async import(name: string) {
    if (name === '@cordisjs/plugin-group') {
      return Group
    }
    return this.modules[name]
  }

  mock(name: string, plugin: (...args: any[]) => any) {
    const wrapped = spy(plugin)
    return this.modules[name] = { apply: wrapped, name } as any
  }

  countActive(name: string) {
    const plugin = this.modules[name]
    return this.ctx.registry.has(plugin) ? this.ctx.registry.get(plugin)!.fibers.length : 0
  }
}

describe('Bun / loader (in-memory tree)', () => {
  const root = new Context()

  let loader: MockLoader
  let foo: Wrapped
  let bar: Wrapped
  let qux: Wrapped

  beforeAll(async () => {
    await root.plugin(MockLoader as any)
    loader = root.loader as any

    foo = loader.mock('foo', (ctx: Context) => ctx.on('internal/update', () => {}))
    bar = loader.mock('bar', (ctx: Context) => ctx.on('internal/update', () => {}))
    qux = loader.mock('qux', (ctx: Context) => ctx.on('internal/update', () => {}))
  })

  it('initiates entries, groups and disabled entries', async () => {
    await loader.read([{
      id: '1',
      name: 'foo',
    }, {
      id: '2',
      name: '@cordisjs/plugin-group',
      config: [{
        id: '3',
        name: 'bar',
        config: { a: 1 },
      }, {
        id: '4',
        name: 'qux',
        disabled: true,
      }],
    }])

    expect(loader.countActive('foo')).toBe(1)
    expect(loader.countActive('bar')).toBe(1)
    expect(loader.countActive('qux')).toBe(0)
  })

  it('updates entries: disables removed, enables previously disabled', async () => {
    await loader.read([{
      id: '1',
      name: 'foo',
    }, {
      id: '4',
      name: 'qux',
    }])

    expect(loader.countActive('foo')).toBe(1)
    expect(loader.countActive('bar')).toBe(0)
    expect(loader.countActive('qux')).toBe(1)
  })

  it('plugin self-update persists config into the tree', async () => {
    loader.store['1']!.fiber!.update({ a: 3 })
    await sleep()
    expect(loader.data).toEqual([{
      id: '1',
      name: 'foo',
      config: { a: 3 },
    }, {
      id: '4',
      name: 'qux',
    }])
  })

  it('plugin self-dispose marks the entry disabled', async () => {
    loader.store['1']!.fiber!.dispose()
    await sleep()
    expect(loader.data).toEqual([{
      id: '1',
      name: 'foo',
      disabled: true,
      config: { a: 3 },
    }, {
      id: '4',
      name: 'qux',
    }])
  })

  it('intercept await blocks activation until tasks settle', async () => {
    const root2 = new Context()
    await root2.plugin(MockLoader as any)
    const loader2 = root2.loader as any as MockLoader

    const { promise, resolve } = Promise.withResolvers<void>()
    loader2.mock('foo', () => promise)
    const barPlugin = loader2.mock('bar', (ctx: Context) => ctx.on('internal/update', () => true))
    Object.assign(barPlugin, { inject: ['never'] })
    loader2.mock('qux', () => {})

    const fooId = await loader2.create({ name: 'foo' })
    const quxId = await loader2.create({
      name: 'qux',
      inject: { loader: true },
      intercept: { loader: { await: true } },
    })
    await sleep()

    expect(loader2.store[fooId].fiber.state).toBe(FiberState.LOADING)
    expect(loader2.store[quxId].fiber.state).toBe(FiberState.PENDING)

    resolve()
    await sleep()
    expect(loader2.store[fooId].fiber.state).toBe(FiberState.ACTIVE)
    expect(loader2.store[quxId].fiber.state).toBe(FiberState.ACTIVE)
  })
})
