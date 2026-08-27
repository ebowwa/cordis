#!/usr/bin/env bun
/**
 * Cordis CLI entrypoint for Bun.
 *
 * Behavior identical to `bin.js`, plus reload-safe lifecycle management for
 * `bun --hot` (and harmless under `bun --watch`):
 *
 * - Per Bun's documented semantics, `--hot` is an in-process soft reload
 *   that PRESERVES `globalThis`, while `--watch` is a hard restart that
 *   resets all runtime state (verified on Bun 1.3.14; see
 *   docs/BUN_COMPATIBILITY.md).
 * - Under `--hot`, re-evaluating the entry would otherwise leak the previous
 *   root fiber's effects (timers, listeners) forever. Therefore each
 *   evaluation first disposes the root context stored under a well-known
 *   `globalThis` symbol, and only then boots the new one. (With
 *   `import.meta.hot` — oven-sh/bun#32856 — disposal can additionally hook
 *   the runtime's own dispose phase.)
 * - Under `--watch` the `globalThis` slot is always empty at boot (state was
 *   reset), so the guard is a no-op.
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

// When the runtime provides import.meta.hot (bun --hot with
// oven-sh/bun#32856), disposal is driven by the runtime's own dispose phase:
// callbacks are awaited to completion BEFORE the module is re-evaluated. This
// is strictly stronger than the globalThis guard below — cleanup finishes
// before any new-generation module code runs — and keeps working even if the
// new evaluation throws partway through.
// On stock Bun / Node import.meta.hot is undefined, so this is skipped.
if (import.meta.hot) {
  import.meta.hot.dispose(() => disposePrevious())
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
