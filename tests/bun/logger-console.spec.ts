import { describe, it, expect, beforeAll } from 'bun:test'
import { Context, Message } from 'cordis'
import { ConsoleExporter } from '@cordisjs/plugin-logger-console'

// Real timers mean the rendered `+Nms` diff is nondeterministic; strip it
// before comparing. Everything else must match the Node output byte-for-byte.

let data: string

function render(msg: Message) {
  return data += exporter.render(msg).replace(/\+\d+ms/, '+Nms') + '\n'
}

let exporter: ConsoleExporter
let ctx: Context

describe('Bun / logger-console', () => {
  beforeAll(() => {
    ctx = new Context()
    exporter = new ConsoleExporter(ctx, { colors: 0, showDiff: true, showTime: '' })
    exporter.export = render
    // silence real console output during the suite
    ;(exporter as any).print = () => {}
  })

  it('formats plain messages with level and label', () => {
    data = ''
    ctx.logger('test').info('hello')
    expect(data).toBe('[I] test hello +Nms\n')
  })

  it('formats errors without stack', () => {
    data = ''
    const inner = new Error('message')
    inner.stack = undefined
    ctx.logger('test').error(inner)
    expect(data).toBe('[E] test message +Nms\n')
  })

  it('formats objects via util.inspect (Bun node:util)', () => {
    data = ''
    ctx.logger('test').info({ foo: 'bar' })
    expect(data).toBe("[I] test { foo: 'bar' } +Nms\n")
  })

  it('supports %o / %O formatters', () => {
    data = ''
    ctx.logger('test').info('%o', { a: 1 })
    expect(data).toBe('[I] test { a: 1 } +Nms\n')
  })

  it('respects log levels', () => {
    data = ''
    const logger = ctx.logger('test')
    logger.debug('hidden')
    expect(data).toBe('')
    logger.level = 3
    logger.debug('shown')
    expect(data).toBeTruthy()
  })
})
