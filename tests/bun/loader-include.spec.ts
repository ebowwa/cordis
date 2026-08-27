import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Fiber } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import LoggerConsole from '@cordisjs/plugin-logger-console'
import { sleep } from './helpers'
import { state as pluginState } from './fixtures/stateful-plugin'

/**
 * Real Include service under Bun: config files are written to a temp dir
 * (so write cycles never dirty the repository) and reference the in-repo
 * stateful plugin via absolute file URL. This exercises the loader's
 * standard dynamic-import fallback (`loader.internal === undefined` under
 * Bun) with Bun's native TypeScript transpilation.
 */

const tempDirs: string[] = []

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-bun-'))
  tempDirs.push(dir)
  return dir
}

const PLUGIN_URL = new URL('./fixtures/stateful-plugin.ts', import.meta.url).href

async function setup(dir: string, config: { filename: string; content: string }) {
  const ctx = new Context()
  await ctx.plugin(LoggerConsole, { colors: 0 })
  const fiber = await ctx.plugin(Loader, {
    baseUrl: pathToFileURL(dir).href + '/',
  })
  const includeId = await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: './' + config.filename, enableLogs: false },
  })
  return { ctx, fiber, includeId }
}

function resetPluginState() {
  pluginState.applies = 0
  pluginState.hits = 0
  pluginState.ticks = 0
  pluginState.lastConfig = undefined
}

describe('Bun / include + loader (real files)', () => {
  it('loads a YAML config and a TypeScript plugin via dynamic import', async () => {
    resetPluginState()
    const dir = await makeTempDir()
    await writeFile(join(dir, 'app.yml'), [
      `- id: plugin`,
      `  name: ${PLUGIN_URL}`,
      `  config:`,
      `    greeting: hello`,
    ].join('\n'))

    const { ctx, fiber } = await setup(dir, { filename: 'app.yml', content: '' })
    await sleep(150)

    expect(pluginState.applies).toBe(1)
    expect(pluginState.lastConfig).toEqual({ greeting: 'hello' })
    expect(ctx.bail('test/get-value')).toBe(1)

    const ticks = pluginState.ticks
    expect(ticks).toBeGreaterThan(0)

    await fiber.dispose()
    await sleep(80)
    const ticksAfter = pluginState.ticks
    expect(ctx.bail('test/get-value')).toBeUndefined()
    await sleep(80)
    expect(pluginState.ticks).toBe(ticksAfter) // interval cleared
  }, 20000)

  it('loads a JSON config', async () => {
    resetPluginState()
    const dir = await makeTempDir()
    await writeFile(join(dir, 'app.json'), JSON.stringify([{
      id: 'plugin',
      name: PLUGIN_URL,
    }], null, 2))

    const { ctx, fiber } = await setup(dir, { filename: 'app.json', content: '' })
    await sleep(150)

    expect(pluginState.applies).toBe(1)
    expect(ctx.bail('test/get-value')).toBe(1)

    await fiber.dispose()
  }, 20000)

  it('loads plugins referenced by relative path from the config file', async () => {
    resetPluginState()
    // read-only in-repo fixture; no write cycles are triggered
    const fixturesDir = new URL('./fixtures/relative/', import.meta.url)
    const ctx = new Context()
    await ctx.plugin(LoggerConsole, { colors: 0 })
    const fiber = await ctx.plugin(Loader, { baseUrl: fixturesDir.href })
    await ctx.loader.create({
      name: '@cordisjs/plugin-include',
      config: { path: './app.yml', enableLogs: false },
    })
    await sleep(150)

    expect(pluginState.applies).toBe(1)
    expect(ctx.bail('test/get-value')).toBe(1)
    await fiber.dispose()
  }, 20000)

  it('evaluates js expressions in YAML config', async () => {
    resetPluginState()
    const dir = await makeTempDir()
    // the canonical explicit-tag form that Include itself writes on dump
    // (verified identical under Node and Bun; the bare `!js` shorthand is
    // only accepted by @cordisjs/unyaml at test-import time, not by the
    // runtime reader)
    await writeFile(join(dir, 'app.yml'), [
      `- id: plugin`,
      `  name: ${PLUGIN_URL}`,
      `  config:`,
      `    stamp: !<tag:yaml.org,2002:js> '1000 + 24'`,
    ].join('\n'))

    const { ctx, fiber } = await setup(dir, { filename: 'app.yml', content: '' })
    await sleep(150)

    expect(pluginState.lastConfig).toEqual({ stamp: 1024 })
    await fiber.dispose()
  }, 20000)

  it('repeated disable/enable cycles do not duplicate listeners or timers', async () => {
    resetPluginState()
    const dir = await makeTempDir()
    const configPath = join(dir, 'app.yml')
    await writeFile(configPath, `- id: plugin\n  name: ${PLUGIN_URL}\n`)

    const { ctx, fiber, includeId } = await setup(dir, { filename: 'app.yml', content: '' })
    await sleep(150)
    expect(pluginState.applies).toBe(1)

    for (let i = 0; i < 3; i++) {
      // disable (entry lives in the include subtree: <includeId>:plugin)
      await ctx.loader.update(includeId + ':plugin', { disabled: true })
      await sleep(120)
      const appliesAfterDisable = pluginState.applies
      const ticksAfterDisable = pluginState.ticks
      ctx.emit('test/ping')
      expect(pluginState.hits).toBe(i) // listener removed: no hit while disabled
      await sleep(60)
      expect(pluginState.ticks).toBe(ticksAfterDisable) // timer removed

      // re-enable
      await ctx.loader.update(includeId + ':plugin', { disabled: null })
      await sleep(120)
      expect(pluginState.applies).toBe(appliesAfterDisable + 1)
      ctx.emit('test/ping')
      expect(pluginState.hits).toBe(i + 1) // exactly one hit: no duplicates

      // ticks resumed: at least one new tick after re-enable
      expect(pluginState.ticks).toBeGreaterThan(ticksAfterDisable)
    }

    // file was written back with the final state (enabled -> no disabled key)
    const content = await readFile(configPath, 'utf8')
    expect(content).not.toContain('disabled')

    await fiber.dispose()
    await sleep(100)
    const finalTicks = pluginState.ticks
    await sleep(100)
    expect(pluginState.ticks).toBe(finalTicks)
  }, 40000)

  it('patches can disable an entry in-memory', async () => {
    resetPluginState()
    const dir = await makeTempDir()
    await writeFile(join(dir, 'app.yml'), `- id: plugin\n  name: ${PLUGIN_URL}\n`)

    const ctx = new Context()
    await ctx.plugin(LoggerConsole, { colors: 0 })
    const fiber = await ctx.plugin(Loader, { baseUrl: pathToFileURL(dir).href + '/' })
    await ctx.loader.create({
      name: '@cordisjs/plugin-include',
      config: { path: './app.yml', enableLogs: false, patches: [{ id: 'plugin', disabled: true }] },
    })
    await sleep(200)

    expect(pluginState.applies).toBe(0)
    expect(ctx.bail('test/get-value')).toBeUndefined()
    await fiber.dispose()
  }, 20000)
})
