/**
 * Reads every page a fiscal sponsor's file cites, with the refresh job's polite fetcher (its own name, robots.txt,
 * one request per host at a time), and checks each quote is on it. A page that refuses us is reported, never bypassed.
 *   bun scripts/data/verify-sponsors.ts [ids...]
 */
import { join } from 'node:path'
import { checkData } from '../../src/data/load'
import { sponsorEvidence } from '../../src/data/sponsors'
import { comparable, quoteOnPage } from '../../src/data/text'
import { readPages } from '../refresh/fetch'

const only = new Set(process.argv.slice(2))
const { sponsors, issues } = checkData(join(process.cwd(), 'data', 'programmes'), null)
const invalid = issues.filter((i) => i.startsWith('sponsors/'))
for (const issue of invalid) console.error(issue)

const chosen = sponsors.filter((s) => only.size === 0 || only.has(s.id))
const unknown = [...only].filter((id) => !sponsors.some((s) => s.id === id))
for (const id of unknown) console.error(`no sponsor ${id}`)
const checks = chosen.flatMap((s) => sponsorEvidence(s).filter((e) => e.method !== 'human').map((e) => ({ id: s.id, ...e })))
const urls = [...new Set(checks.map((c) => c.source_url))]
const pages = new Map([...(await readPages(urls.map((url) => ({ url, selector: null }))))].map(([item, page]) => [item.url, page]))

let failed = 0
for (const c of checks) {
  const page = pages.get(c.source_url)!
  if (page.ok && quoteOnPage(comparable(page.text), c.quote)) continue
  failed++
  console.error(`FAIL ${c.id} ${c.source_url}\n  ${page.ok ? 'quote not on page' : `${page.kind}: ${page.message}`}: "${c.quote}"`)
}
console.log(`${checks.length - failed}/${checks.length} quotes verified across ${urls.length} pages and ${chosen.length} fiscal sponsors`)
process.exit(failed || invalid.length || unknown.length ? 1 : 0)
