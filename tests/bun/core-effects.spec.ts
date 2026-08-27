import { describe, it, expect } from 'bun:test'
import { Context } from 'cordis'
import { spy, sleep, getHookSnapshot } from './helpers'

describe('Bun / core: effects', () => {
  it('sync effect disposer runs exactly once on plugin disposal', async () => {
    const root = new Context()
    const dispose = spy(() => {})
    const fiber = await root.plugin((ctx) => {
      ctx.effect(() => dispose, 'test')
    })
    expect(fiber.getEffects()).toEqual([{ label: 'test', children: [] }])
    expect(dispose.calls.length).toBe(0)
    await fiber.dispose()
    expect(dispose.calls.length).toBe(1)
    await fiber.dispose()
    expect(dispose.calls.length).toBe(1)
  })

  it('effects are disposed in reverse registration order', async () => {
    const root = new Context()
    const seq: number[] = []
    const dispose = root.effect(function* () {
      yield () => seq.push(1)
      yield () => seq.push(2)
      yield () => seq.push(3)
    })
    expect(seq).toEqual([])
    dispose()
    expect(seq).toEqual([3, 2, 1])
    dispose()
    expect(seq).toEqual([3, 2, 1])
  })

  it('nested plugin cleanup is complete, idempotent, and Node-identical', async () => {
    const seq: string[] = []
    const root = new Context()
    const fiber = await root.plugin((ctx) => {
      ctx.effect(() => () => seq.push('outer'))
      ctx.plugin((ctx2) => {
        ctx2.effect(() => () => seq.push('inner'))
        ctx2.plugin((ctx3) => {
          ctx3.effect(() => () => seq.push('innermost'))
        })
      })
    })
    expect(seq).toEqual([])
    await fiber.dispose()
    // Cross-fiber teardown is scheduled by async depth, so the observable
    // order is outer-most sync disposers first — verified byte-identical
    // under Node v26.4.0 (see docs/BUN_COMPATIBILITY.md). Within a single
    // effect, disposers run in strict reverse (covered above).
    expect(seq).toEqual(['outer', 'inner', 'innermost'])
    // every disposer ran exactly once; repeated dispose is a no-op
    await fiber.dispose()
    expect(seq).toEqual(['outer', 'inner', 'innermost'])
  })

  it('async effect (promise of disposer)', async () => {
    const seq: number[] = []
    const root = new Context()
    const dispose = root.effect(async () => {
      await sleep(20)
      seq.push(1)
      return () => seq.push(2)
    })
    expect(seq).toEqual([])
    await dispose()
    expect(seq).toEqual([1, 2])
  })

  it('async generator effect: mid-segment dispose lets the current segment finish', async () => {
    const seq: number[] = []
    const root = new Context()
    const dispose = root.effect(async function* () {
      await sleep(10)
      seq.push(1)
      yield () => seq.push(2)
      await sleep(40)
      seq.push(3)
      yield () => seq.push(4)
    })
    await sleep(15) // first segment done, second pending
    expect(seq).toEqual([1])
    dispose()
    // the pending segment completes, then its disposer and the earlier one
    // run in reverse: [1, 3, 4, 2]
    await sleep(80)
    expect(seq).toEqual([1, 3, 4, 2])
    await sleep(40)
    expect(seq).toEqual([1, 3, 4, 2])
  })

  it('async generator effect collects all disposers in reverse when awaited', async () => {
    const seq: number[] = []
    const root = new Context()
    const dispose = root.effect(async function* () {
      yield () => seq.push(2)
      await sleep(10)
      yield () => seq.push(4)
      await sleep(10)
      yield () => seq.push(6)
    })
    seq.push(1)
    await sleep(30)
    seq.push(3)
    await dispose()
    expect(seq).toEqual([1, 3, 6, 4, 2])
  })

  it('hook registry returns to its snapshot after dispose/reload cycles', async () => {
    async function plugin(ctx: Context) {
      ctx.on('custom-event', () => {})
      await ctx.plugin(async (ctx) => {
        ctx.on('custom-event', () => {})
        await ctx.plugin((ctx) => {
          ctx.on('custom-event', () => {})
        })
      })
    }

    const root = new Context()
    const before = getHookSnapshot(root)
    const fiber = await root.plugin(plugin)
    const after = getHookSnapshot(root)
    expect(after).not.toEqual(before)

    await fiber.dispose()
    await sleep()
    expect(getHookSnapshot(root)).toEqual(before)

    await root.plugin(plugin)
    expect(getHookSnapshot(root)).toEqual(after)
  })
})
