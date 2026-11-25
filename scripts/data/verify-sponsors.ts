/**
 * Reads every page a fiscal sponsor's file cites, with the refresh job's polite fetcher (its own name, robots.txt,
 * one request per host at a time), and checks each quote is on it. A page that refuses us is reported, never bypassed.
 * The weekly re-read (scripts/refresh/sponsors.ts) with nothing written: the counts are the dates it would move.
 *   bun scripts/data/verify-sponsors.ts [ids...]
 */
import { join } from 'node:path'
import { checkData } from '../../src/data/load'
import { readSponsorPages, sponsorCounts, sponsorMoves, sponsorPass, sponsorProblems } from '../refresh/sponsors'

const only = new Set(process.argv.slice(2))
const { sponsors, issues } = checkData(join(process.cwd(), 'data', 'programmes'), null)
const invalid = issues.filter((i) => i.startsWith('sponsors/'))
for (const issue of invalid) console.error(issue)

const chosen = sponsors.filter((s) => only.size === 0 || only.has(s.id))
const unknown = [...only].filter((id) => !sponsors.some((s) => s.id === id))
for (const id of unknown) console.error(`no sponsor ${id}`)

const pass = sponsorPass(chosen, await readSponsorPages(chosen), new Date())
const problems = sponsorProblems(pass)
for (const p of problems) console.error(p)
for (const m of sponsorMoves(pass)) console.log(m)
console.log(`Nothing written. ${sponsorCounts(pass, chosen.length)}`)
process.exit(problems.length || invalid.length || unknown.length ? 1 : 0)
