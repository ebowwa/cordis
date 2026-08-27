// cold-start app: minimal (Context + 3 plugins)
import { Context } from 'cordis'
const ctx = new Context()
const p = c => { c.on('x', () => {}) }
await ctx.plugin(p); await ctx.plugin(p); await ctx.plugin(p)
console.log('READY')
await new Promise(r => setTimeout(r, 5))
process.exit(0)
