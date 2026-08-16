#!/usr/bin/env bun
/**
 * Cordis CLI entrypoint for Bun.
 *
 * Behavior identical to `bin.js`, plus reload-safe lifecycle management for
 * `bun --watch` / `bun --hot`:
 *
 * - Bun re-evaluates the entry module in the same process on watch reloads:
 *   module state is cleared but `globalThis` state and live timers SURVIVE.
 *   Without disposal, every reload leaks the previous root fiber's effects
 *   (timers, listeners) forever (verified on Bun 1.3.14; see
 *   docs/BUN_COMPATIBILITY.md).
 * - Therefore each evaluation first disposes the root context stored under a
 *   well-known `globalThis` symbol, and only then boots the new one.
 * - SIGINT/SIGTERM dispose the current root completely before exiting.
 *
 * The Node entrypoint (`bin.js`) is intentionally untouched.
 */

import { Context } from 'cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@cordisjs/plugin-loader'

/** globalThis slot holding the current root Context across re-evaluations */
const ROOT = Symbol.for('cordis.bun.root')
/** guard so signal handlers are registered exactly once per process */
const SIGNALS = Symbol.for('cordis.bun.signals')

async function disposePrevious() {
  const previous = globalThis[ROOT]
  if (!previous) return
  globalThis[ROOT] = undefined
  try {
    await previous.fiber.dispose()
  } catch (error) {
    console.error('[cordis] failed to dispose previous root context')
    console.error(error)
  }
}

if (!globalThis[SIGNALS]) {
  globalThis[SIGNALS] = true
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      const root = globalThis[ROOT]
      if (root) {
        globalThis[ROOT] = undefined
        try {
          await root.fiber.dispose()
        } catch (error) {
          console.error('[cordis] failed to dispose root context on ' + signal)
          console.error(error)
        }
      }
      process.exit(0)
    })
  }
}

// disposal of the old root strictly precedes activation of the new one
await disposePrevious()

const ctx = new Context()
globalThis[ROOT] = ctx
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: {
    path: './cordis.yml',
  },
})
