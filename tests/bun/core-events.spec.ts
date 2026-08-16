import { describe, it, expect } from 'bun:test'
import { Context } from 'cordis'
import { spy, sleep } from './helpers'

describe('Bun / core: events', () => {
  it('ctx.on() / dispose', () => {
    const root = new Context()
    const callback = spy(() => {})
    const dispose = root.on('custom-event', callback)
    root.emit('custom-event')
    expect(callback.calls.length).toBe(1)
    dispose()
    root.emit('custom-event')
    expect(callback.calls.length).toBe(1)
  })

  it('ctx.once()', () => {
    const root = new Context()
    const callback = spy(() => {})
    root.once('custom-event', callback)
    root.emit('custom-event')
    root.emit('custom-event')
    expect(callback.calls.length).toBe(1)
  })

  it('ctx.emit() is synchronous', async () => {
    const root = new Context()
    const seq: string[] = []
    root.on('custom-event', () => seq.push('listener'))
    seq.push('before')
    root.emit('custom-event')
    seq.push('after')
    expect(seq).toEqual(['before', 'listener', 'after'])
  })

  it('ctx.parallel() awaits all listeners and aggregates errors', async () => {
    const root = new Context()
    const callback = spy(async () => {
      await sleep(5)
      throw new Error('async')
    })
    const dispose = root.on('custom-event', callback)
    const error = await root.parallel('custom-event').catch(e => e)
    expect(error).toBeInstanceOf(AggregateError)
    expect(error.errors.map((e: Error) => e.message)).toEqual(['async'])
    dispose()

    // a rejecting listener must not short-circuit a later one
    const seq: string[] = []
    root.on('custom-event', async () => { throw new Error('a') })
    const d2 = root.on('custom-event', async () => {
      await sleep(10)
      seq.push('late')
    })
    const err2 = await root.parallel('custom-event').catch(e => e)
    expect(err2).toBeInstanceOf(AggregateError)
    expect(seq).toEqual(['late'])
    d2()
  })

  it('ctx.serial() awaits listeners in order and stops at first bail value', async () => {
    const root = new Context()
    const order: number[] = []
    root.on('custom-event', async () => {
      await sleep(10)
      order.push(1)
      return undefined
    })
    root.on('custom-event', async () => {
      order.push(2)
      return 'second'
    })
    root.on('custom-event', () => {
      order.push(3)
      return 'third'
    })
    const result = await root.serial('custom-event')
    expect(order).toEqual([1, 2])
    expect(result).toBe('second')
  })

  it('ctx.bail() returns first bail-worthy result synchronously', () => {
    const root = new Context()
    root.on('custom-event', () => undefined)
    root.on('custom-event', () => false)
    // null, false and undefined never bail — dispatch continues to the end
    expect(root.bail('custom-event')).toBeUndefined()
    root.on('custom-event', () => 0, true) // prepended; 0 is a bail value
    expect(root.bail('custom-event')).toBe(0)
  })

  it('ctx.waterfall() composes values through next()', () => {
    const root = new Context()
    root.on('custom-event', (value: number, next: () => number) => value + next())
    root.on('custom-event', (value: number, next: () => number) => value + next())
    expect(root.waterfall('custom-event', 1, () => 2)).toBe(4)

    // a listener that returns without calling next() short-circuits the rest
    const root2 = new Context()
    const late = spy(() => 99)
    root2.on('custom-event', (value: number, next: () => number) => value + next())
    root2.on('custom-event', (value: number, next: () => number) => value + next())
    root2.on('custom-event', (value: number) => value)
    root2.on('custom-event', late)
    expect(root2.waterfall('custom-event', 1, () => 2)).toBe(3)
    expect(late.calls.length).toBe(0)
  })

  it('event listeners registered inside a plugin are removed on dispose', async () => {
    const root = new Context()
    const callback = spy(() => {})
    const fiber = await root.plugin((ctx) => {
      ctx.on('custom-event', callback)
    })
    root.emit('custom-event')
    expect(callback.calls.length).toBe(1)
    callback.reset()
    await fiber.dispose()
    root.emit('custom-event')
    expect(callback.calls.length).toBe(0)
  })
})
