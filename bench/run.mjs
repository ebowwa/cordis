/**
 * Benchmark orchestrator (run under Node).
 *
 * Subcommands:
 *   run    --runtime node|bun --label NAME [--filter substr]
 *   cold                                 (both runtimes: interpreter, minimal app, loader app)
 *   leak   --runtime node|bun
 *   profile --runtime node|bun --label NAME
 *   compare LABEL...                     (merged table from bench/results/*.json)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(HERE, 'results')
mkdirSync(RESULTS, { recursive: true })

const BUN_BIN = process.env.BUN_BIN ?? join(homedir(), '.bun', 'bin', 'bun')

function runtimeCmd(runtime) {
  if (runtime === 'node') return { cmd: 'node', base: ['--import', 'tsx'] }
  return { cmd: BUN_BIN, base: [] }
}

function runCapture(runtime, args) {
  const { cmd, base } = runtimeCmd(runtime)
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...base, ...args], {
      cwd: dirname(HERE),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', c => { stdout += c })
    child.stderr.on('data', c => { stderr += c })
    child.on('exit', code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${runtime} ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`)))
    child.on('error', reject)
  })
}

function fmtTable(rows, headers) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i]).length)))
  const line = cells => cells.map((c, i) => String(c).padEnd(widths[i])).join('  |  ')
  return [line(headers), ...rows.map(line)].join('\n')
}

async function cmdRun(runtime, label, filter) {
  const args = [join(HERE, 'main.mjs')]
  if (filter) args.push('--filter', filter)
  process.stdout.write(`[run] ${label} (${runtime}) workloads…\n`)
  const { stdout, stderr } = await runCapture(runtime, args)
  const marker = stdout.split('\n').find(l => l.startsWith('@@RESULTS'))
  if (!marker) throw new Error('no results marker\n' + stderr)
  const results = JSON.parse(marker.slice('@@RESULTS '.length))
  writeFileSync(join(RESULTS, `${label}.json`), JSON.stringify(results, null, 2))
  printWorkloads(label, results)
}

function printWorkloads(label, results) {
  const rows = results.map(r => [r.name, r.ops, r.batches, r.medianMs.toFixed(2), r.usPerOp.toFixed(2)])
  console.log('\n' + fmtTable(rows, ['workload', 'ops/batch', 'batches', 'median ms', 'us/op']) + `\n  -> saved results/${label}.json\n`)
}

function timeToReady(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', c => {
      out += c
      if (out.includes('READY')) {
        child.kill('SIGKILL')
        resolve(performance.now() - t0)
      }
    })
    child.stderr.on('data', c => { out += c })
    child.on('exit', code => {
      if (out.includes('READY')) resolve(performance.now() - t0)
      else reject(new Error(`no READY (exit ${code}): ${cmd} ${args.join(' ')}\n${out.slice(0, 2000)}`))
    })
    child.on('error', reject)
  })
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

async function measureN(n, fn) {
  const times = []
  for (let i = 0; i < n; i++) times.push(await fn())
  return { median: median(times), min: Math.min(...times), max: Math.max(...times) }
}

async function cmdCold() {
  const N = 10
  const rows = []
  const variants = []

  // interpreter baseline
  variants.push({ name: 'interp -e READY', node: ['node', ['-e', "console.log('READY')"]], bun: [BUN_BIN, ['-e', "console.log('READY')"]] })
  // minimal cordis app (no TS involved -> no tsx preload for node)
  variants.push({ name: 'cold-min (Context+3 plugins)', node: ['node', [join(HERE, 'cold-min.mjs')]], bun: [BUN_BIN, [join(HERE, 'cold-min.mjs')]] })

  const tempDirs = []
  const loaderVariants = [
    { suffix: 'mjs', name: 'cold-loader-js (3 JS plugins)', ts: false },
    { suffix: 'ts', name: 'cold-loader-ts (3 TS plugins)', ts: true },
  ]
  for (const { suffix, name, ts } of loaderVariants) {
    const cfgDir = await mkdtemp(join(tmpdir(), 'cordis-cold-'))
    tempDirs.push(cfgDir)
    // let plain Node resolve 'cordis' from the temp dir (Bun ignores this)
    await symlink(join(dirname(HERE), 'node_modules'), join(cfgDir, 'node_modules'), 'dir')
    const lines = []
    for (let i = 0; i < 3; i++) {
      await writeFile(join(cfgDir, `plugin-${i}.${suffix}`), "import { Context } from 'cordis'\nexport function apply(ctx: Context) { ctx.on('x', () => {}) }\n")
      lines.push(`- id: p${i}`, `  name: ./plugin-${i}.${suffix}`)
    }
    await writeFile(join(cfgDir, 'cordis.yml'), lines.join('\n') + '\n')
    const nodeArgs = [...(ts ? ['--import', 'tsx'] : []), join(HERE, 'cold-loader.mjs'), cfgDir]
    variants.push({
      name,
      node: ['node', nodeArgs],
      bun: [BUN_BIN, [join(HERE, 'cold-loader.mjs'), cfgDir]],
    })
  }

  for (const v of variants) {
    const row = [v.name]
    for (const rt of ['node', 'bun']) {
      const [cmd, args] = v[rt]
      const r = await measureN(N, () => timeToReady(cmd, args, dirname(HERE)))
      row.push(r.median.toFixed(1), `${r.min.toFixed(1)}–${r.max.toFixed(1)}`)
    }
    rows.push(row)
  }
  await Promise.all(tempDirs.map(d => rm(d, { recursive: true, force: true })))
  console.log('\n' + fmtTable(rows, ['cold start (ms, median of 10)', 'node med', 'node range', 'bun med', 'bun range']) + '\n')
}

async function cmdLeak(runtime) {
  const { stdout, stderr } = await runCapture(runtime, [join(HERE, 'leak.mjs'), '--expose-gc'].filter(a => !(runtime === 'bun' && a === '--expose-gc')))
  const marker = stdout.split('\n').find(l => l.startsWith('@@LEAK'))
  if (!marker) throw new Error('no leak marker\n' + stderr)
  const r = JSON.parse(marker.slice('@@LEAK '.length))
  const rows = [
    ['runtime', r.runtime],
    ['cycles', r.cycles],
    ['rss growth (MB)', r.rssGrowthMB],
    ['heap growth (MB)', r.heapGrowthMB],
    ['registry empty', r.registryEmpty],
    ['leftover hooks', r.leftoverHooks.length ? r.leftoverHooks.join(',') : 'none'],
  ]
  console.log('\n' + fmtTable(rows, ['leak check', 'value']) + '\n')
  writeFileSync(join(RESULTS, `leak-${runtime}.json`), JSON.stringify(r, null, 2))
}

async function cmdProfile(runtime, label) {
  const dir = join(RESULTS, `prof-${label}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const { cmd, base } = runtimeCmd(runtime)
  const args = [...base]
  if (runtime === 'node') args.push('--cpu-prof', '--cpu-prof-dir=' + dir)
  else args.push('--cpu-prof', '--cpu-prof-dir=' + dir)
  args.push(join(HERE, 'profile.mjs'))
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: dirname(HERE), stdio: 'inherit' })
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`profile exited ${code}`)))
  })
  const files = readdirSync(dir).filter(f => f.endsWith('.cpuprofile'))
  console.log(`\n[profile] ${label}: ${files.length} profile(s) in results/prof-${label}/`)
}

async function cmdCompare(labels) {
  const datas = labels.map(l => ({
    label: l,
    results: JSON.parse(readFileSync(join(RESULTS, `${l}.json`), 'utf8')),
  }))
  const names = datas[0].results.map(r => r.name)
  const rows = []
  for (const name of names) {
    const row = [name]
    let first = null, last = null
    for (const d of datas) {
      const r = d.results.find(x => x.name === name)
      const v = r ? r.usPerOp.toFixed(2) : '—'
      row.push(v)
      if (r) {
        if (first === null) first = r.usPerOp
        last = r.usPerOp
      }
    }
    row.push(first ? (last / first).toFixed(2) + 'x' : '—')
    rows.push(row)
  }
  const headers = ['workload', ...labels.map(l => l + ' µs/op'), `${labels[labels.length - 1]} / ${labels[0]}`]
  console.log('\n' + fmtTable(rows, headers) + '\n')
}

const [sub, ...rest] = process.argv.slice(2)
const arg = (name) => {
  const i = rest.indexOf('--' + name)
  return i >= 0 ? rest[i + 1] : undefined
}

switch (sub) {
  case 'run':
    await cmdRun(arg('runtime'), arg('label'), arg('filter'))
    break
  case 'cold':
    await cmdCold()
    break
  case 'leak':
    await cmdLeak(arg('runtime'))
    break
  case 'profile':
    await cmdProfile(arg('runtime'), arg('label'))
    break
  case 'compare':
    await cmdCompare(rest)
    break
  default:
    console.error('usage: node bench/run.mjs run|cold|leak|profile|compare …')
    process.exit(1)
}
