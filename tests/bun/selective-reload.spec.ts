import { describe, it, expect } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Selective plugin reload via file:// query cache-busting.
 *
 * Requires a Bun build shipping oven-sh/bun#39426 ("keep a file:// URL's
 * query in module keys") — before it, `import(url + "?v=N")` returned the
 * same cached module instance for every query, so per-module reload via
 * public APIs was impossible on Bun (the reason selective HMR was deferred
 * to Phase C in docs/BUN_COMPATIBILITY.md).
 *
 * The driver (`fixtures/selective-reload-driver.ts`) swaps one plugin
 * generation in-process while the root keeps running; this spec asserts the
 * transcript's ordering:
 *  1. `?gen=N` yields a FRESH module instance per generation
 *     (`captured=reloaded` proves a new evaluation);
 *  2. the old plugin's fiber is disposed AFTER the new one applies and its
 *     timers stop — only the new generation ticks afterwards;
 *  3. root-owned effects keep ticking across the swap, unduplicated, and
 *     are disposed exactly once, at shutdown.
 *
 * Runner selection is by capability probe, not version: BUN_QUERY_BUSTING_BIN
 * env var, else a sibling Bun checkout at `../bun` relative to this repo
 * (i.e. ~/Developer/bun — release `build/release/bun` preferred, then
 * debug `build/debug/bun-debug`). Skips cleanly when no capable binary
 * exists (stock Bun, CI).
 */

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const DRIVER = fileURLToPath(new URL('./fixtures/selective-reload-driver.ts', import.meta.url))

function candidateBin(): string | undefined {
  // resolved to an absolute path: the driver child process runs with a
  // temp cwd, so a relative binary path would not resolve from there
  if (process.env.BUN_QUERY_BUSTING_BIN) return resolve(process.env.BUN_QUERY_BUSTING_BIN)
  const candidates = [
    // a sibling Bun checkout (~/Developer/bun)
    ...['build/release/bun', 'build/debug/bun-debug'].map(
      rel => join(resolve(REPO_ROOT, '../bun'), rel)),
    // the preserved release binary from the bun-39426 GitHub release
    join(REPO_ROOT, '.upstream/bin/bun-39426'),
  ]
  return candidates.find(existsSync)
}

/** capability probe: does import(url+query) bypass the module cache? */
function hasQueryBusting(bin: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'cordis-qb-probe-'))
  try {
    const file = join(dir, 'm.ts')
    writeFileSync(file, 'export const t = Date.now()\n')
    const script = `
      const u = new URL(${JSON.stringify(pathToFileURL(file).href)})
      const a = await import(u.href + "?v=1")
      await new Promise(r => setTimeout(r, 30))
      const b = await import(u.href + "?v=2")
      console.log("QB:" + (a.t !== b.t))
    `
    const res = spawnSync(bin, ['-e', script], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: '1' },
    })
    return (res.stdout + '').includes('QB:true')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const BIN = candidateBin()

describe('Bun / selective plugin reload (bun#39426 query cache-busting)', () => {
  it.skipIf(!BIN || !hasQueryBusting(BIN!))(
    'query-busted generation swap disposes only the old plugin fiber',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cordis-selective-'))
      try {
        await symlink(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')

        const child = spawn(BIN!, [DRIVER], {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, BUN_DEBUG_QUIET_LOGS: '1', NO_COLOR: '1' },
        })
        let stdout = ''
        child.stdout.on('data', c => { stdout += c })
        child.stderr.on('data', c => { stdout += c })
        const code = await new Promise<number | null>(res => child.on('exit', res))

        const lines = stdout.split('\n').filter(l => l.startsWith('[') || l.startsWith('---'))
        const idx = (needle: string) => lines.findIndex(l => l.includes(needle))

        // generation 1 activated and ticked before the swap
        expect(idx('apply gen=1')).toBeGreaterThan(-1)
        expect(idx('tick gen=1')).toBeGreaterThan(-1)
        expect(idx('tick gen=1')).toBeLessThan(idx('swap'))

        // fresh instance for gen=2 (captured=reloaded proves a new evaluation)
        expect(idx('apply gen=2 captured=reloaded')).toBeGreaterThan(idx('swap'))
        // old plugin disposed only after the new one applied
        expect(idx('disposed gen=1')).toBeGreaterThan(idx('apply gen=2'))

        // after gen=1's disposal, only gen=2 ticks
        const disposed1 = idx('disposed gen=1')
        expect(lines.slice(disposed1).some(l => l.includes('tick gen=1'))).toBe(false)
        expect(lines.slice(disposed1).some(l => l.includes('tick gen=2'))).toBe(true)

        // root-owned effects survive the swap unduplicated, disposed once at shutdown
        const swapAt = idx('swap')
        const shutdownAt = idx('shutdown')
        expect(shutdownAt).toBeGreaterThan(-1)
        expect(lines.slice(swapAt, shutdownAt).some(l => l.includes('[resident] disposed'))).toBe(false)
        expect(lines.slice(swapAt, shutdownAt).filter(l => l.includes('[resident] tick')).length).toBeGreaterThan(0)
        expect(lines.filter(l => l.includes('[resident] disposed')).length).toBe(1)
        expect(idx('[resident] disposed')).toBeGreaterThan(shutdownAt)
        expect(idx('disposed gen=2')).toBeGreaterThan(shutdownAt)

        expect(code).toBe(0)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 60000)
})
