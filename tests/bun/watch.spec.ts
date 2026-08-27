import { describe, it, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Phase 5A: development reload via the Bun supervisor
 * (`packages/core/bin.bun.watch.js`).
 *
 * Asserts the restart contract: on file change the previous generation's
 * root fiber is fully disposed (its disposers run) BEFORE the next
 * generation activates, and resources never duplicate.
 */

const SUPERVISOR = fileURLToPath(new URL('../../packages/core/bin.bun.watch.js', import.meta.url))
const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)))

const PLUGIN = [
  "import { Context } from 'cordis'",
  '',
  'export function apply(ctx: Context) {',
  "  console.log('[app] applied gen=' + GEN)",
  '  ctx.effect(() => {',
  "    const t = setInterval(() => console.log('[app] tick'), 150)",
  '    return () => { clearInterval(t); console.log(\'[app] timer-cleared gen=\' + GEN) }',
  '  })',
  '}',
  '',
  "declare const GEN: number",
].join('\n')

describe('Bun / development reload (supervisor)', () => {
  it('file change disposes the old root before activating the new one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cordis-bun-watch-'))
    try {
      await symlink(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
      await writeFile(join(dir, 'cordis.yml'), '- id: plugin\n  name: ./plugin.ts\n')
      await writeFile(join(dir, 'plugin.ts'), 'const GEN = 1\n' + PLUGIN)

      const child = spawn(process.execPath, [SUPERVISOR], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      })

      let stdout = ''
      child.stdout.on('data', c => { stdout += c })
      child.stderr.on('data', c => { stdout += c })

      await waitFor(() => stdout.includes('applied gen=1'))

      // edit the plugin: generation 2
      await writeFile(join(dir, 'plugin.ts'), 'const GEN = 2\n' + PLUGIN)
      await waitFor(() => stdout.includes('applied gen=2'))

      // generation 3
      await writeFile(join(dir, 'plugin.ts'), 'const GEN = 3\n' + PLUGIN)
      await waitFor(() => stdout.includes('applied gen=3'))

      // graceful shutdown
      child.kill('SIGINT')
      const code = await new Promise<number | null>(res => child.on('exit', res))

      const lines = stdout.split('\n').filter(l => l.startsWith('[app]'))

      // every generation activated exactly once
      expect(lines.filter(l => l.includes('applied gen=1')).length).toBe(1)
      expect(lines.filter(l => l.includes('applied gen=2')).length).toBe(1)
      expect(lines.filter(l => l.includes('applied gen=3')).length).toBe(1)

      // disposal strictly precedes the next activation
      const clear1 = lines.findIndex(l => l.includes('timer-cleared gen=1'))
      const apply2 = lines.findIndex(l => l.includes('applied gen=2'))
      const clear2 = lines.findIndex(l => l.includes('timer-cleared gen=2'))
      const apply3 = lines.findIndex(l => l.includes('applied gen=3'))
      expect(clear1).toBeGreaterThan(-1)
      expect(clear1).toBeLessThan(apply2)
      expect(clear2).toBeGreaterThan(-1)
      expect(clear2).toBeLessThan(apply3)

      // the final generation is disposed by SIGINT
      expect(lines.some(l => l.includes('timer-cleared gen=3'))).toBe(true)

      // config file survived unchanged (no write-back corruption)
      expect(await readFile(join(dir, 'cordis.yml'), 'utf8')).toBe('- id: plugin\n  name: ./plugin.ts\n')

      expect(code).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30000)
})

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
