import { describe, it, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

describe('Bun / process shutdown with complete root disposal', () => {
  it('SIGINT triggers full root-fiber disposal and a clean exit', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/shutdown-app.ts', import.meta.url))
    const child = spawn(process.execPath, [fixture], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })

    // wait for readiness
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('app did not become ready; stdout=' + stdout + ' stderr=' + stderr)), 15000)
      child.stdout.on('data', chunk => {
        if (stdout.includes('ready')) {
          clearTimeout(timer)
          resolve()
        }
      })
    })

    child.kill('SIGINT')

    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('app did not exit; stdout=' + stdout)), 15000)
      child.on('exit', code => {
        clearTimeout(timer)
        resolve(code)
      })
    })

    expect(code).toBe(0)

    // all disposers ran; order follows async depth (outer's own sync
    // disposers before the nested child's chain) — verified Node-identical
    const eventsLine = stdout.split('\n').find(line => line.startsWith('events:'))
    expect(eventsLine).toBeDefined()
    expect(JSON.parse(eventsLine!.slice('events:'.length))).toEqual(['outer-stop', 'inner-stop'])

    // every plugin fiber was disposed from the registry
    const registryLine = stdout.split('\n').find(line => line.startsWith('registry:'))
    expect(registryLine).toBeDefined()
    expect(registryLine!.slice('registry:'.length)).toBe('0')
  }, 40000)
})
