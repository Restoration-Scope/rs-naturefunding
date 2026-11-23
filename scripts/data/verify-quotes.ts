/**
 * Fetches every page a fact cites and checks each quote appears on it, after folding
 * typography and case. Pages are cached for the day in .cache/pages.
 *   bun scripts/data/verify-quotes.ts [--dir <programmes dir>] [--fresh] [ids...]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkData, evidenceOf } from '../../src/data/load'
import { comparable, normalise, quoteOnPage } from '../../src/data/text'
import { browserRead } from '../requirements/browser-reads'
import { fetchPage, htmlToText } from './page-text'
import { readPdf } from './pdf'

const args = process.argv.slice(2)
const dirAt = args.indexOf('--dir')
const dir = dirAt === -1 ? join(process.cwd(), 'data', 'programmes') : resolve(args[dirAt + 1])
const fresh = args.includes('--fresh')
const only = new Set(args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir'))

const { programmes, issues } = checkData(dir, null)
for (const issue of issues) console.error(`skipped, invalid: ${issue}`)

type Check = { programme: string; url: string; quote: string; method: 'page' | 'api' | 'human' }
const checks: Check[] = programmes
  .filter((p) => only.size === 0 || only.has(p.id))
  .flatMap((p) => evidenceOf(p).map((e) => ({ programme: p.id, url: e.source_url, quote: e.quote, method: e.method })))

const fetchedChecks = checks.filter((c) => c.method !== 'human')
const skippedHuman = checks.length - fetchedChecks.length
const urls = [...new Set(fetchedChecks.map((c) => c.url))]
const pages = new Map<string, string | Error>()
let next = 0
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < urls.length) {
      const url = urls[next++]
      try {
        pages.set(url, comparable((await fetchPage(url, { fresh })).text))
      } catch (e) {
        pages.set(url, e as Error)
      }
    }
  }),
)

// A page that refuses our fetcher (a bot filter, a challenge page) is checked against its browser copy, as the gather read it.
const copies = new Map<string, string | null>()
const browserText = async (url: string) => {
  if (!copies.has(url)) {
    const copy = browserRead(url)
    copies.set(url, copy ? comparable(copy.pdf ? normalise(readPdf(copy.bytes).pages.join('\n')) : await htmlToText(new TextDecoder().decode(copy.bytes))) : null)
  }
  return copies.get(url)!
}
const failures = (
  await Promise.all(
    fetchedChecks.map(async (c) => {
      const page = pages.get(c.url)!
      if (page instanceof Error || !quoteOnPage(page, c.quote)) {
        const copy = await browserText(c.url)
        if (copy !== null && quoteOnPage(copy, c.quote)) return []
      }
      if (page instanceof Error) return [{ ...c, reason: `fetch failed: ${page.message}` }]
      return quoteOnPage(page, c.quote) ? [] : [{ ...c, reason: 'quote not on page' }]
    }),
  )
).flat()

for (const f of failures) console.error(`FAIL ${f.programme} ${f.url}\n  ${f.reason}: "${f.quote}"`)
const passed = fetchedChecks.length - failures.length
console.log(
  `${passed}/${fetchedChecks.length} quotes verified across ${urls.length} pages and ${new Set(checks.map((c) => c.programme)).size} programmes${
    skippedHuman ? `; ${skippedHuman} human-read quotes skipped` : ''
  }`,
)

mkdirSync(join(process.cwd(), '.cache'), { recursive: true })
writeFileSync(
  join(process.cwd(), '.cache', 'verify-report.json'),
  JSON.stringify({ ran_at: new Date().toISOString(), checks: checks.length, fetched: fetchedChecks.length, skippedHuman, passed, failures }, null, 2),
)
process.exit(failures.length === 0 && issues.length === 0 ? 0 : 1)
