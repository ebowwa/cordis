import { describe, it, expect } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Upstream integration: oven-sh/bun#32856 (`import.meta.hot` for `bun --hot`).
 *
 * Cordis consumes the PR build — it does not reimplement module reloading.
 * The binary is fetched with `bunx bun-pr 32856` (no Bun checkout needed).
 *
 * Proves, against the PR build only (all of Cordis's hot-reload cases):
 *  1. root-fiber disposal COMPLETES before the next generation activates —
 *     including an async disposer (the PR's awaited-dispose claim);
 *  2. resources never duplicate across reloads (timers of generation N stop
 *     before generation N+1 starts);
 *  3. a module the next generation no longer imports is disposed too, and
 *     its resources stop (the PR's removed-modules claim);
 *  4. clean SIGINT shutdown of the final generation.
 *
 * Known --hot limitation (verified): editing cordis.yml triggers NO reload —
 * the config file is not part of the module graph. Use the supervisor
 * (bin.bun.watch.js, whose fs.watch does catch config edits) or touch a
 * watched module.
 *
 * Skipped when the PR binary is not installed (stock Bun: `import.meta.hot`
 * is undefined there — see docs/BUN_COMPATIBILITY.md "Development reload
 * semantics").
 */

const ENTRY = fileURLToPath(new URL('../../packages/core/bin.bun.js', import.meta.url))
const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)))

const PLUGIN = [
  "import { Context } from 'cordis'",
  '',
  'export function apply(ctx: Context) {',
  "  console.log('[app] applied gen=' + GEN)",
  '  ctx.effect(() => {',
  "    const t = setInterval(() => console.log('[app] tick gen=' + GEN), 150)",
  '    return async () => {',
  "      console.log('[app] cleanup-start gen=' + GEN)",
  '      await new Promise(r => setTimeout(r, 150))',
  '      clearInterval(t)',
  "      console.log('[app] cleanup-done gen=' + GEN)",
  '    }',
  '  })',
  '}',
  '',
  'declare const GEN: number',
].join('\n')

function findPrBinary(): string | undefined {
  // 1. explicit override
  if (process.env.BUN_PR_BIN && existsSync(process.env.BUN_PR_BIN)) {
    return process.env.BUN_PR_BIN
  }
  // 2. the alias bun-pr installs into ~/.bun/bin
  const candidates = [join(homedir(), '.bun', 'bin')]
  for (const dir of candidates) {
    if (!existsSync(dir)) continue
    const exact = join(dir, 'bun-32856')
    if (existsSync(exact)) return exact
    // 3. the full sha-named binary bun-<sha>-pr32856
    const match = readdirSync(dir).find(name => /^bun-[0-9a-f]{40}-pr32856$/.test(name))
    if (match) return join(dir, match)
  }
  return undefined
}

const PR_BIN = findPrBinary()

/** does this binary provide import.meta.hot under --hot? */
function hasHotSupport(bin: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'cordis-bun-hot-probe-'))
  try {
    const file = join(dir, 'probe.ts')
    writeFileSync(file, 'console.log("HOT:" + typeof (import.meta as any).hot)\n')
    const res = spawnSync(bin, ['--hot', file], { encoding: 'utf8', timeout: 20000 })
    return (res.stdout + '').includes('HOT:object')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// imported at top of file; skip logic uses findPrBinary()/hasHotSupport()

describe('Bun / development reload (bun#32856 import.meta.hot)', () => {
  it.skipIf(!PR_BIN || !hasHotSupport(PR_BIN))(
    'awaited disposal completes before reactivation; resources never duplicate',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cordis-bun-hot-'))
      try {
        await symlink(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
        await writeFile(join(dir, 'cordis.yml'), '- id: plugin\n  name: ./plugin.ts\n')
        await writeFile(join(dir, 'plugin.ts'), 'const GEN = 1\n' + PLUGIN)

        const child = spawn(PR_BIN!, ['--hot', ENTRY], {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
        })

        let stdout = ''
        child.stdout.on('data', c => { stdout += c })
        child.stderr.on('data', c => { stdout += c })

        await waitFor(() => stdout.includes('applied gen=1'))
        // let generation 1 tick at least once before editing
        await waitFor(() => stdout.includes('tick gen=1'))

        await writeFile(join(dir, 'plugin.ts'), 'const GEN = 2\n' + PLUGIN)
        await waitFor(() => stdout.includes('applied gen=2'))
        await waitFor(() => stdout.includes('tick gen=2'))

        await writeFile(join(dir, 'plugin.ts'), 'const GEN = 3\n' + PLUGIN)
        await waitFor(() => stdout.includes('applied gen=3'))
        await waitFor(() => stdout.includes('tick gen=3'))

        child.kill('SIGINT')
        const code = await new Promise<number | null>(res => child.on('exit', res))
        await sleep(200) // let trailing ticks surface

        const lines = stdout.split('\n').filter(l => l.startsWith('[app]'))
        const idx = (needle: string) => lines.findIndex(l => l.includes(needle))

        // every generation activated exactly once
        for (const gen of [1, 2, 3]) {
          expect(lines.filter(l => l.includes(`applied gen=${gen}`)).length).toBe(1)
        }

        // awaited disposal: cleanup STARTS and COMPLETES before the next
        // activation — the disposer awaits a 150ms timer, so this can only
        // pass if the runtime awaits the dispose phase before re-evaluation
        expect(idx('cleanup-start gen=1')).toBeGreaterThan(-1)
        expect(idx('cleanup-done gen=1')).toBeGreaterThan(-1)
        expect(idx('cleanup-done gen=1')).toBeLessThan(idx('applied gen=2'))
        expect(idx('cleanup-done gen=2')).toBeGreaterThan(-1)
        expect(idx('cleanup-done gen=2')).toBeLessThan(idx('applied gen=3'))

        // resources never duplicate: after generation N+1 activates, no
        // timer of generation N fires again
        const applied2 = idx('applied gen=2')
        const applied3 = idx('applied gen=3')
        expect(lines.slice(applied2).some(l => l.includes('tick gen=1'))).toBe(false)
        expect(lines.slice(applied3).some(l => l.includes('tick gen=1'))).toBe(false)
        expect(lines.slice(applied3).some(l => l.includes('tick gen=2'))).toBe(false)

        // the final generation is disposed by SIGINT
        expect(lines.some(l => l.includes('cleanup-done gen=3'))).toBe(true)

        // config file survived unchanged (no write-back corruption)
        expect(await readFile(join(dir, 'cordis.yml'), 'utf8')).toBe('- id: plugin\n  name: ./plugin.ts\n')

        expect(code).toBe(0)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 60000)

  it.skipIf(!PR_BIN || !hasHotSupport(PR_BIN))(
    'failed evaluation keeps the previous root disposed and recovers on next edit',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cordis-bun-hot-broken-'))
      try {
        await symlink(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
        await writeFile(join(dir, 'cordis.yml'), '- id: plugin\n  name: ./plugin.ts\n')
        await writeFile(join(dir, 'plugin.ts'), 'const GEN = 1\n' + PLUGIN)

        const child = spawn(PR_BIN!, ['--hot', ENTRY], {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
        })

        let stdout = ''
        child.stdout.on('data', c => { stdout += c })
        child.stderr.on('data', c => { stdout += c })

        await waitFor(() => stdout.includes('applied gen=1'))
        await waitFor(() => stdout.includes('tick gen=1'))

        // introduce a syntax error: the next generation must fail to
        // evaluate, but generation 1 must have been disposed first.
        // (No error text is printed by bun --hot here — the observable is
        // disposal happening with no `applied gen=2` following it.)
        await writeFile(join(dir, 'plugin.ts'), 'const GEN = 2\nthis is not valid ts !!\n' + PLUGIN)
        await waitFor(() => stdout.includes('cleanup-done gen=1'))
        const disposedAt = stdout.length
        await sleep(600)

        // no generation-1 ticks since the failed reload: the old root was
        // disposed before evaluation of the broken generation
        expect(stdout.slice(disposedAt).includes('tick gen=1')).toBe(false)
        // and the broken generation never activated
        expect(stdout.includes('applied gen=2')).toBe(false)

        // recover with a valid generation 3
        await writeFile(join(dir, 'plugin.ts'), 'const GEN = 3\n' + PLUGIN)
        await waitFor(() => stdout.includes('applied gen=3'))
        await waitFor(() => stdout.includes('tick gen=3'))
        expect(stdout.includes('applied gen=2')).toBe(false)

        child.kill('SIGINT')
        const code = await new Promise<number | null>(res => child.on('exit', res))
        expect(code).toBe(0)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 60000)

  it.skipIf(!PR_BIN || !hasHotSupport(PR_BIN))(
    'module no longer imported by the next generation is disposed and stops',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cordis-bun-hot-removed-'))
      try {
        await symlink(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
        await writeFile(join(dir, 'cordis.yml'), '- id: plugin\n  name: ./plugin.ts\n')

        // helper.ts owns a timer via ctx.effect AND its own
        // import.meta.hot.dispose — gen 2 of plugin.ts drops the import.
        const HELPER = [
          'const gen = (globalThis as any).__hgen = ((globalThis as any).__hgen ?? 0) + 1',
          'console.log(`[helper] loaded gen=${gen}`)',
          'const hot: any = (import.meta as any).hot',
          'if (hot) hot.dispose(() => console.log(`[helper] hot-disposed gen=${gen}`))',
          'export function registerHelper(ctx: any) {',
          '  ctx.effect(() => {',
          '    const t = setInterval(() => console.log(`[helper] tick gen=${gen}`), 150)',
          '    return () => { clearInterval(t); console.log(`[helper] effect-cleaned gen=${gen}`) }',
          '  })',
          '}',
        ].join('\n')
        const PLUGIN_WITH = [
          "import { registerHelper } from './helper.ts'",
          'export function apply(ctx: any) {',
          "  console.log('[app] applied gen=1')",
          '  registerHelper(ctx)',
          '}',
        ].join('\n')
        const PLUGIN_WITHOUT = [
          'export function apply(ctx: any) {',
          "  console.log('[app] applied gen=2')",
          '}',
        ].join('\n')

        await writeFile(join(dir, 'helper.ts'), HELPER)
        await writeFile(join(dir, 'plugin.ts'), PLUGIN_WITH)

        const child = spawn(PR_BIN!, ['--hot', ENTRY], {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
        })

        let stdout = ''
        child.stdout.on('data', c => { stdout += c })
        child.stderr.on('data', c => { stdout += c })

        await waitFor(() => stdout.includes('applied gen=1'))
        await waitFor(() => stdout.includes('tick gen=1'))

        // gen 2 removes the helper import: bun#32856 claims modules the
        // next generation no longer imports are disposed too
        await writeFile(join(dir, 'plugin.ts'), PLUGIN_WITHOUT)
        await waitFor(() => stdout.includes('applied gen=2'))
        await sleep(600)

        child.kill('SIGINT')
        const code = await new Promise<number | null>(res => child.on('exit', res))

        const lines = stdout.split('\n')
        const idx = (needle: string) => lines.findIndex(l => l.includes(needle))

        // the no-longer-imported module's dispose callback ran...
        expect(idx('[helper] hot-disposed gen=1')).toBeGreaterThan(-1)
        // ...and the Cordis root-fiber disposal completed...
        expect(idx('[helper] effect-cleaned gen=1')).toBeGreaterThan(-1)
        // ...both strictly before the new generation activated
        expect(idx('[helper] hot-disposed gen=1')).toBeLessThan(idx('applied gen=2'))
        expect(idx('[helper] effect-cleaned gen=1')).toBeLessThan(idx('applied gen=2'))

        // and the helper's timer never fired again afterwards
        const applied2 = idx('applied gen=2')
        expect(lines.slice(applied2).some(l => l.includes('tick gen=1'))).toBe(false)

        // gen 2 applied exactly once
        expect(lines.filter(l => l.includes('applied gen=2')).length).toBe(1)

        expect(code).toBe(0)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }, 60000)
})

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function waitFor(predicate: () => boolean, timeout = 15000) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now()
    const check = setInterval(() => {
      if (predicate()) {
        clearInterval(check)
        resolve()
      } else if (Date.now() - started > timeout) {
        clearInterval(check)
        reject(new Error('waitFor timed out'))
      }
    }, 50)
  })
}
