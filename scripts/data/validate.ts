/**
 * Checks data/: schema, file name = id, unique ids, parents, and that the watch list
 * covers every page a fact cites.
 *   bun scripts/data/validate.ts [--dir <programmes dir>] [--no-sources]
 */
import { join, resolve } from 'node:path'
import { checkData } from '../../src/data/load'

const args = process.argv.slice(2)
const dirAt = args.indexOf('--dir')
const dir = dirAt === -1 ? join(process.cwd(), 'data', 'programmes') : resolve(args[dirAt + 1])
const sourcesFile = args.includes('--no-sources') ? null : join(process.cwd(), 'data', 'sources.json')

const { programmes, sources, issues } = checkData(dir, sourcesFile)
const open = programmes.flatMap((p) => p.calls).filter((c) => c.status === 'open').length

for (const issue of issues) console.error(issue)
console.log(`${programmes.length} programmes, ${open} open calls, ${sources.length} sources, ${issues.length} problems`)
process.exit(issues.length === 0 ? 0 : 1)
