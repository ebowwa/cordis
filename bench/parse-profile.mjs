/**
 * Aggregate a Chrome .cpuprofile by self time (hitCount) and print the top N.
 * Works for both node --cpu-prof and bun --cpu-prof output.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const file = process.argv[2]
const top = Number(process.argv[3] ?? 15)

const profile = JSON.parse(readFileSync(file, 'utf8'))
const nodes = profile.nodes ?? []

let totalHits = 0
const byKey = new Map()
for (const node of nodes) {
  const hits = node.hitCount ?? 0
  if (!hits) continue
  totalHits += hits
  const cf = node.callFrame ?? {}
  const fn = cf.functionName || '(anonymous)'
  const url = cf.url ? basename(new URL(cf.url, 'file://').pathname) : '(native)'
  const key = `${fn} @ ${url}`
  byKey.set(key, (byKey.get(key) ?? 0) + hits)
}

const entries = [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
const duration = (profile.timeDeltas ?? []).reduce((a, b) => a + b, 0) / 1000

console.log(`profile: ${basename(file)}`)
console.log(`samples: ${totalHits} hits, ~${duration.toFixed(0)}ms sampled`)
for (const [key, hits] of entries) {
  const pct = ((hits / totalHits) * 100).toFixed(1).padStart(5)
  console.log(`  ${pct}%  ${hits.toString().padStart(7)}  ${key}`)
}
