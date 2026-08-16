/**
 * In-process benchmark workloads for Cordis, runnable under Node and Bun
 * from the same source. Plain ESM JavaScript; no test-framework deps.
 *
 * Each workload: setup() -> warmup batches -> timed batches -> teardown().
 * Report per-op time from the MEDIAN batch (robust to scheduler noise).
 */

import { Context, Service } from 'cordis'
import Timer from '@cordisjs/plugin-timer'
import { Loader, Group } from '@cordisjs/plugin-loader'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

class BenchLoader extends Loader {
  static modules = {}

  write() {}
  async read(data) {
    await this.root.update(data)
    await this.await()
  }
  async import(name) {
    if (name === '@cordisjs/plugin-group') return Group
    return BenchLoader.modules[name]
  }
}

const PLUGIN_TS = [
  "import { Context } from 'cordis'",
  'export function apply(ctx: Context) {',
  "  ctx.on('bench-event', () => {})",
  '}',
].join('\n')

export const workloads = [
  {
    name: 'context-create',
    ops: 2000, batches: 5, warmup: 1,
    batch() {
      const arr = new Array(this.ops)
      for (let i = 0; i < this.ops; i++) arr[i] = new Context()
    },
  },
  {
    name: 'plugin-lifecycle',
    ops: 1000, batches: 5, warmup: 1,
    setup() {
      const root = new Context()
      const plugin = ctx => {
        ctx.on('bench-event', () => {})
        ctx.effect(() => () => {})
      }
      return { root, plugin }
    },
    async batch({ root, plugin }) {
      for (let i = 0; i < this.ops; i++) {
        const fiber = await root.plugin(plugin)
        await fiber.dispose()
      }
    },
  },
  {
    name: 'plugin-bulk-500',
    ops: 500, batches: 5, warmup: 1,
    setup() {
      const root = new Context()
      const child = ctx => { ctx.on('bench-event', () => {}) }
      const parent = async ctx => {
        const tasks = []
        for (let i = 0; i < 500; i++) tasks.push(ctx.plugin(child))
        await Promise.all(tasks)
      }
      return { root, parent }
    },
    async batch({ root, parent }) {
      const fiber = await root.plugin(parent)
      await fiber.dispose()
      await sleep(1)
    },
  },
  {
    name: 'effects-sync-5',
    ops: 10000, batches: 5, warmup: 1,
    setup() { return { root: new Context() } },
    batch({ root }) {
      const disposers = new Array(this.ops)
      for (let i = 0; i < this.ops; i++) {
        disposers[i] = root.effect(function* () {
          yield () => {}
          yield () => {}
          yield () => {}
          yield () => {}
          yield () => {}
        })
      }
      for (const d of disposers) d()
    },
  },
  {
    name: 'effects-async',
    ops: 2000, batches: 5, warmup: 1,
    setup() { return { root: new Context() } },
    async batch({ root }) {
      for (let i = 0; i < this.ops; i++) {
        const d = root.effect(async () => {
          await sleep(0)
          return () => {}
        })
        await d()
      }
    },
  },
  {
    name: 'emit-10-listeners',
    ops: 20000, batches: 5, warmup: 1,
    setup() {
      const root = new Context()
      for (let i = 0; i < 10; i++) root.on('bench-event', () => {})
      return { root }
    },
    batch({ root }) {
      for (let i = 0; i < this.ops; i++) root.emit('bench-event')
    },
  },
  {
    name: 'parallel-10-async',
    ops: 1000, batches: 5, warmup: 1,
    setup() {
      const root = new Context()
      for (let i = 0; i < 10; i++) root.on('bench-event', async () => {})
      return { root }
    },
    async batch({ root }) {
      for (let i = 0; i < this.ops; i++) await root.parallel('bench-event')
    },
  },
  {
    name: 'serial-5',
    ops: 2000, batches: 5, warmup: 1,
    setup() {
      const root = new Context()
      for (let i = 0; i < 5; i++) root.on('bench-event', async () => {})
      return { root }
    },
    async batch({ root }) {
      for (let i = 0; i < this.ops; i++) await root.serial('bench-event')
    },
  },
  {
    name: 'bail-5',
    ops: 50000, batches: 3, warmup: 1,
    setup() {
      const root = new Context()
      root.on('bench-event', () => {})
      root.on('bench-event', () => {})
      root.on('bench-event', () => 'x')
      root.on('bench-event', () => {})
      root.on('bench-event', () => {})
      return { root }
    },
    batch({ root }) {
      for (let i = 0; i < this.ops; i++) root.bail('bench-event')
    },
  },
  {
    name: 'waterfall-5',
    ops: 20000, batches: 5, warmup: 1,
    setup() {
      const root = new Context()
      for (let i = 0; i < 5; i++) {
        root.on('bench-event', (v, next) => v + next())
      }
      return { root }
    },
    batch({ root }) {
      for (let i = 0; i < this.ops; i++) root.waterfall('bench-event', 1, () => 2)
    },
  },
  {
    name: 'inject-cycles',
    ops: 1000, batches: 5, warmup: 1,
    setup() {
      const root = new Context()
      root.inject(['bench-svc'], () => {})
      return { root }
    },
    async batch({ root }) {
      for (let i = 0; i < this.ops; i++) {
        const d = root.provide('bench-svc', i)
        await sleep(0)
        d()
        await sleep(0)
      }
    },
  },
  {
    name: 'isolate-provide',
    ops: 1000, batches: 5, warmup: 1,
    setup() {
      const root = new Context()
      const ctxs = []
      for (let i = 0; i < 100; i++) {
        const ctx = root.isolate('bench-svc')
        ctx.inject(['bench-svc'], () => {})
        ctxs.push(ctx)
      }
      return { root, ctxs }
    },
    async batch({ ctxs }) {
      for (let i = 0; i < this.ops; i++) {
        const d = ctxs[i % 100].provide('bench-svc', i)
        await sleep(0)
        d()
        await sleep(0)
      }
    },
  },
  {
    name: 'timer-effect',
    ops: 5000, batches: 5, warmup: 1,
    async setup() {
      const root = new Context()
      await root.plugin(Timer)
      return { root }
    },
    batch({ root }) {
      const disposers = new Array(this.ops)
      for (let i = 0; i < this.ops; i++) disposers[i] = root.timeout(() => {}, 1e9)
      for (const d of disposers) d()
    },
  },
  {
    name: 'loader-mock-50',
    ops: 300, batches: 5, warmup: 1,
    async setup() {
      const root = new Context()
      for (let i = 0; i < 50; i++) {
        BenchLoader.modules[`p${i}`] = { apply: ctx => { ctx.on('bench-event', () => {}) } }
      }
      await root.plugin(BenchLoader)
      const loader = root.loader
      const base = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, name: `p${i}` }))
      return { loader, base }
    },
    async batch({ loader, base }) {
      // 6 tree updates of 50 entries each = 300 entry transitions
      await loader.read(base)
      for (let round = 0; round < 5; round++) {
        const next = base.map((e, i) => ({
          ...e,
          disabled: (i + round) % 2 === 0 ? true : null,
        }))
        await loader.read(next)
      }
    },
  },
  {
    name: 'include-boot-20-plugins',
    ops: 1, batches: 8, warmup: 1,
    async setup() {
      const dir = await mkdtemp(join(tmpdir(), 'cordis-bench-'))
      const lines = []
      for (let i = 0; i < 20; i++) {
        await writeFile(join(dir, `plugin-${i}.ts`), PLUGIN_TS, 'utf8')
        lines.push(`- id: p${i}`, '  name: ./plugin-' + i + '.ts')
      }
      await writeFile(join(dir, 'cordis.yml'), lines.join('\n') + '\n', 'utf8')
      return { dir }
    },
    async batch({ dir }) {
      const ctx = new Context()
      const fiber = await ctx.plugin(Loader, {
        baseUrl: pathToFileURL(dir).href + '/',
      })
      await ctx.loader.create({
        name: '@cordisjs/plugin-include',
        config: { path: './cordis.yml', enableLogs: false },
      })
      await ctx.loader.await()
      await fiber.dispose()
      await sleep(1)
    },
    async teardown({ dir }) {
      await rm(dir, { recursive: true, force: true })
    },
  },
  {
    name: 'module-eval-ts',
    ops: 150, batches: 4, warmup: 1,
    async setup() {
      const dir = await mkdtemp(join(tmpdir(), 'cordis-bench-mod-'))
      const file = join(dir, 'plugin.ts')
      await writeFile(file, PLUGIN_TS, 'utf8')
      return { url: pathToFileURL(file).href }
    },
    async batch({ url }, batchIndex) {
      for (let i = 0; i < this.ops; i++) {
        // cache-busting query: forces transpile + eval of a fresh module
        await import(/* @vite-ignore */ `${url}?b${batchIndex}i${i}`)
      }
    },
    async teardown({ url }) {
      const dir = new URL('.', url).pathname
      await rm(dir, { recursive: true, force: true })
    },
  },
]

export async function runWorkloads(filter) {
  const results = []
  for (const w of workloads) {
    if (filter && !w.name.includes(filter)) continue
    const state = await w.setup?.() ?? {}
    for (let i = 0; i < (w.warmup ?? 1); i++) await w.batch(state, -1 - i)
    const times = []
    for (let i = 0; i < w.batches; i++) {
      const t0 = performance.now()
      await w.batch(state, i)
      times.push(performance.now() - t0)
    }
    await w.teardown?.(state)
    const sorted = [...times].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    results.push({
      name: w.name,
      ops: w.ops,
      batches: w.batches,
      timesMs: times.map(t => +t.toFixed(3)),
      medianMs: +median.toFixed(3),
      usPerOp: +(median * 1000 / w.ops).toFixed(3),
    })
    process.stderr.write(`  done: ${w.name} (${(median * 1000 / w.ops).toFixed(2)} us/op)\n`)
  }
  return results
}
