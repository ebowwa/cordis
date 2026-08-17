#!/usr/bin/env node
/**
 * Compare bench passes across runtimes into a multi-config table.
 *
 * Reads bench/results/<label>.json (same-day r1/r2 passes per config) and
 * emits a markdown table of best/worst us/op per workload per config with
 * node/bun ratios. Feeds docs/BUN_BENCH.md (multi-config matrix section).
 *
 *   node bench/compare.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), 'results')

const CONFIGS = [
  ['fork node', ['fork-node-r1', 'fork-node-r2']],
  ['bun 1.3.14', ['bun-r1', 'bun-r2']],
  ['bun-39426', ['bun39426-r1', 'bun39426-r2']],
]

function load(label) {
  const p = join(RESULTS, `${label}.json`)
  if (!existsSync(p)) {
    throw new Error(`missing ${p}`)
  }
  const out = {}
  for (const w of JSON.parse(readFileSync(p, 'utf8'))) out[w.name] = w.usPerOp
  return out
}

const data = {}
for (const [name, labels] of CONFIGS) data[name] = labels.map(load)

const names = [...new Set(CONFIGS.flatMap(([name]) => Object.keys(data[name][0])))]

console.log('| workload | ' + CONFIGS.map(([c]) => `${c} (best/worst)`).join(' | ') + ' | node/bun | node/bun-39426 |')
console.log('| --- | ' + CONFIGS.map(() => '---').join(' | ') + ' | --- | --- |')
for (const n of names) {
  const cells = []
  const vals = {}
  for (const [cfg] of CONFIGS) {
    const passes = data[cfg].map(d => d[n]).filter(v => v !== undefined)
    if (!passes.length) {
      cells.push('-')
    } else {
      cells.push(`${Math.round(Math.min(...passes))} / ${Math.round(Math.max(...passes))}`)
      vals[cfg] = Math.min(...passes)
    }
  }
  const r = (a, b) => a && b ? `${(a / b).toFixed(1)}x` : '-'
  console.log(`| ${n} | ${cells.join(' | ')} | ${r(vals['fork node'], vals['bun 1.3.14'])} | ${r(vals['fork node'], vals['bun-39426'])} |`)
}
