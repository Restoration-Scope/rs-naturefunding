/**
 * Checks data/: schema, file name = id, unique ids, parents, that the watch list
 * covers every page a fact cites, and that each Before you apply reading has had its second reader.
 *   bun scripts/data/validate.ts [--dir <programmes dir>] [--no-sources] [--no-review] [--requirements <manifests dir>]
 */
import { join, resolve } from 'node:path'
import { checkData } from '../../src/data/load'
import { readManifests, reviewProblems } from '../requirements/review'

const args = process.argv.slice(2)
const dirAt = args.indexOf('--dir')
const dir = dirAt === -1 ? join(process.cwd(), 'data', 'programmes') : resolve(args[dirAt + 1])
const sourcesFile = args.includes('--no-sources') ? null : join(process.cwd(), 'data', 'sources.json')

const { programmes, sources, issues } = checkData(dir, sourcesFile)
const reqAt = args.indexOf('--requirements')
if (!args.includes('--no-review')) issues.push(...reviewProblems(programmes, readManifests(reqAt === -1 ? undefined : resolve(args[reqAt + 1]))))
const open = programmes.flatMap((p) => p.calls).filter((c) => c.status === 'open').length

for (const issue of issues) console.error(issue)
console.log(`${programmes.length} programmes, ${open} open calls, ${sources.length} sources, ${issues.length} problems`)
process.exit(issues.length === 0 ? 0 : 1)
