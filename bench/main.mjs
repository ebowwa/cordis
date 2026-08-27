import { runWorkloads } from './workloads.mjs'

const filter = process.argv.includes('--filter')
  ? process.argv[process.argv.indexOf('--filter') + 1]
  : ''

process.stderr.write(`[bench] runtime=${typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.version}\n`)
const results = await runWorkloads(filter)
// machine-readable line for the orchestrator
console.log('@@RESULTS ' + JSON.stringify(results))
