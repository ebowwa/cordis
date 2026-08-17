import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { Context } from 'cordis'
// The browser entry is loaded BY PATH, deliberately: under Bun the `node`
// export condition matches for the bare specifier, which selects lib/index.js.
// lib/browser.js is exactly the file a browser/web bundler consumes via the
// export map's `default` condition — verified declaratively at the bottom.
import { ConsoleExporter } from '../../packages/logger-console/lib/browser.js'
import { spy } from './helpers'

/**
 * Browser export of @cordisjs/plugin-logger-console, verified under Bun.
 *
 * The browser build is a "universal" build: its only environment requirement
 * is a `console` (it routes `[TYPE] name` + raw args to console.log/warn/error
 * and leaves inspection to the native console — no node:util.inspect, no
 * supports-color, no DOM usage). Verified here:
 *
 *  1. plugin wiring through ctx.plugin (exercises the schemastery Config
 *     static, which is a real runtime dependency of the browser build);
 *  2. level routing: error → console.error, warn → console.warn,
 *     everything else → console.log, with the `[T] name` prefix
 *     (this Cordis version's logger levels are info/warn/error/debug —
 *     there is no `success` shortcut);
 *  3. argument pass-through BY IDENTITY (the browser contract — the exporter
 *     must not serialize; the console does the inspecting);
 *  4. log levels respected (debug suppressed at the default level);
 *  5. declaratively: the export map selects browser.js for non-node
 *     consumers, and the shipped browser artifact contains zero `node:`
 *     specifiers.
 */

const log = spy()
const warn = spy()
const error = spy()
const original = { log: console.log, warn: console.warn, error: console.error }

let ctx: Context

describe('Bun / logger-console (browser export)', () => {
  beforeAll(() => {
    console.log = log as any
    console.warn = warn as any
    console.error = error as any
    ctx = new Context()
    ctx.plugin(ConsoleExporter)
  })

  afterAll(async () => {
    Object.assign(console, original)
    await ctx?.fiber.dispose()
  })

  it('registers through ctx.plugin and routes info to console.log', () => {
    log.reset()
    ctx.logger('test').info('hello')
    expect(log.calls.length).toBe(1)
    expect(log.calls[0][0]).toBe('[I] test')
    expect(log.calls[0][1]).toBe('hello')
  })

  it('routes error to console.error and warn to console.warn', () => {
    error.reset(); warn.reset(); log.reset()
    ctx.logger('test').error('boom')
    ctx.logger('test').warn('careful')
    expect(error.calls.length).toBe(1)
    expect(error.calls[0][0]).toBe('[E] test')
    expect(error.calls[0][1]).toBe('boom')
    expect(warn.calls.length).toBe(1)
    expect(warn.calls[0][0]).toBe('[W] test')
    expect(warn.calls[0][1]).toBe('careful')
    expect(log.calls.length).toBe(0)
  })

  it('passes arguments through by identity — the console does the inspecting', () => {
    log.reset()
    const obj = { foo: 'bar' }
    const err = new Error('native')
    ctx.logger('test').info('meta', obj, err, 42)
    expect(log.calls.length).toBe(1)
    const args = log.calls[0]
    expect(args.length).toBe(5)
    expect(args[0]).toBe('[I] test')
    // untouched references, not serialized strings:
    expect(args[2]).toBe(obj)
    expect(args[3]).toBe(err)
    expect(args[4]).toBe(42)
  })

  it('respects log levels', () => {
    log.reset()
    const logger = ctx.logger('test')
    logger.debug('hidden')
    expect(log.calls.length).toBe(0)
    logger.level = 3
    logger.debug('shown')
    expect(log.calls.length).toBe(1)
    expect(log.calls[0][1]).toBe('shown')
  })

  it('never touches document/window globals', () => {
    // the browser build must not require a DOM: exercise it with these
    // globals hard-absent, not merely undefined
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'document')
    try {
      // @ts-expect-error scrubbing the global on purpose
      delete (globalThis as any).document
      // @ts-expect-error scrubbing the global on purpose
      delete (globalThis as any).window
      log.reset()
      ctx.logger('test').info('no dom needed')
      expect(log.calls.length).toBe(1)
    } finally {
      if (desc) Object.defineProperty(globalThis, 'document', desc)
    }
  })

  it('export map selects the browser entry for non-node consumers', async () => {
    const pkg = JSON.parse(await readFile(new URL('../../packages/logger-console/package.json', import.meta.url), 'utf8'))
    expect(pkg.exports['.'].node).toBe('./lib/index.js')
    expect(pkg.exports['.'].default).toBe('./lib/browser.js')
  })

  it('shipped browser artifact contains no node: specifiers', async () => {
    const source = await readFile(new URL('../../packages/logger-console/lib/browser.js', import.meta.url), 'utf8')
    expect(source.includes('node:')).toBe(false)
    // and it really is the browser implementation, not the node one
    expect(source.includes('message.type === "error" ? "error"')).toBe(true)
    expect(source.includes('inspect')).toBe(false)
  })
})
