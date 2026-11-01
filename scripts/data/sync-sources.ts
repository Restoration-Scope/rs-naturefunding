/**
 * Rebuilds data/sources.json from the pages programmes cite: adds a source for every new
 * evidence URL (picking a main-text selector that still holds all its quotes), drops sources
 * no fact cites unless they carry a hand-written hint, and sets each cycle from the
 * programme's state. Hand-edited selectors and hints are kept.
 *   bun scripts/data/sync-sources.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkData, evidenceOf } from '../../src/data/load'
import type { Programme, Source } from '../../src/data/schema'
import { comparable, fetchPage } from './page-text'

const SELECTORS = ['main', '[role="main"]', 'article', '#content', '#main', '.content']
const file = join(process.cwd(), 'data', 'sources.json')

const { programmes, issues } = checkData(undefined, null)
if (issues.length > 0) {
  for (const issue of issues) console.error(issue)
  console.error('fix the programme files first')
  process.exit(1)
}
const existing: Source[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []

function cycle(p: Programme): Source['cycle'] {
  if (p.calls.some((c) => c.status === 'open' || c.status === 'upcoming')) return 'daily'
  return p.access === 'direct' ? 'weekly' : 'monthly'
}

async function pickSelector(url: string, quotes: string[]): Promise<string | null> {
  for (const selector of SELECTORS) {
    try {
      const text = comparable((await fetchPage(url, { selector })).text)
      if (text.length > 200 && quotes.every((q) => text.includes(comparable(q)))) return selector
    } catch {}
  }
  return null
}

const next: Source[] = []
for (const p of programmes) {
  const mine = existing.filter((s) => s.programme_id === p.id)
  const evidence = evidenceOf(p)
  const handPicked = mine.filter((s) => s.hint !== null).map((s) => s.url)
  const urls = [...new Set([...evidence.map((e) => e.source_url), ...handPicked])]
  let n = Math.max(0, ...mine.map((s) => Number(s.id.slice(p.id.length + 1)) || 0))
  for (const url of urls) {
    const kept = mine.find((s) => s.url === url)
    if (kept) {
      next.push({ ...kept, cycle: cycle(p) })
      continue
    }
    const quotes = evidence.filter((e) => e.source_url === url).map((e) => e.quote)
    next.push({ id: `${p.id}-${++n}`, programme_id: p.id, url, selector: await pickSelector(url, quotes), hint: null, cycle: cycle(p) })
  }
}

writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
console.log(`${next.length} sources for ${programmes.length} programmes (${next.length - existing.length >= 0 ? '+' : ''}${next.length - existing.length})`)
