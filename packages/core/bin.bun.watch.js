#!/usr/bin/env bun
/**
 * Cordis development supervisor for Bun — Phase 5A of the Bun port.
 *
 * Why a supervisor instead of plain `bun --watch` (measured on Bun 1.3.14,
 * see docs/BUN_COMPATIBILITY.md):
 *
 * - `bun --watch` re-evaluates the entry in-process: every reload gets a
 *   fresh `globalThis`/`process`, so the new evaluation cannot reach the
 *   previous Cordis root context — Cordis disposers never run on reload.
 * - Bun clears pending *timers* from previous evaluations, but without
 *   invoking disposers, and old signal handlers accumulate.
 * - `bun --hot` keeps previous evaluations' timers and listeners running,
 *   duplicating Cordis state (verified).
 *
 * The supervisor spawns the real entrypoint as a child process and restarts
 * it on file changes. Restart = SIGTERM → the child disposes its complete
 * root fiber (timers, listeners, services) → exits 0 → respawn. This is the
 * only way to get genuine graceful disposal per reload using public APIs.
 *
 * Usage: bun packages/core/bin.bun.watch.js [child args...]
 * (run from your application directory, like bin.js / bin.bun.js)
 */

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { relative, resolve } from 'node:path'

const DEBOUNCE = 100
const SHUTDOWN_TIMEOUT = 5000
const IGNORED = ['node_modules', '.git']

const entry = resolve(new URL('.', import.meta.url).pathname, 'bin.bun.js')
const rootDir = process.cwd()

let child
let stopping = false
let restartTimer

function isIgnored(path) {
  const rel = relative(rootDir, path)
  return IGNORED.some(prefix => rel === prefix || rel.startsWith(prefix + '/'))
}

function start() {
  child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: rootDir,
  })
  child.on('exit', (code, signal) => {
    if (stopping) return
    if (signal) {
      // crashed or killed outside of a restart — restart like a watcher would
      console.log(`[cordis] child exited with ${signal}, restarting`)
      start()
    }
  })
  return child
}

function stop(signal = 'SIGTERM') {
  return new Promise((done) => {
    if (!child || child.exitCode !== null) return done()
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done()
    }, SHUTDOWN_TIMEOUT)
    child.once('exit', () => {
      clearTimeout(timer)
      done()
    })
    child.kill(signal)
  })
}

const watcher = watch(rootDir, { recursive: true }, (_, filename) => {
  if (restartTimer) clearTimeout(restartTimer)
  const path = resolve(rootDir, String(filename))
  if (isIgnored(path)) return
  restartTimer = setTimeout(async () => {
    restartTimer = undefined
    console.log('[cordis] change detected in', String(filename), '— restarting')
    await stop()
    start()
  }, DEBOUNCE)
})

async function shutdown(signal) {
  if (stopping) return
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  watcher.close()
  await stop(signal)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

start()
