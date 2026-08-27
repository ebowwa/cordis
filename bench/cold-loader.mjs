// cold-start app: Loader + Include + 3 TypeScript plugins from config dir
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'

const dir = process.argv[2]
const ctx = new Context()
ctx.baseUrl = new URL('.', pathFromDir(dir)).href

const fiber = await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: { path: './cordis.yml', enableLogs: false },
})
await ctx.loader.await()
console.log('READY')
await new Promise(r => setTimeout(r, 5))
await fiber.dispose()
process.exit(0)

function pathFromDir(d) {
  return 'file://' + (d.endsWith('/') ? d : d + '/')
}
