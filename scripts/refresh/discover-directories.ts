/**
 * Weekly discovery from curated directories: pages where another organisation lists open calls. A
 * directory is a tip for where to look, so only each card's title and its link to the funder are
 * read; its amounts, deadlines and summaries are never kept. Each funder page not yet cited or
 * raised becomes a row in one review issue (label discovery), and data/checks/discovered.json
 * (keys `dir:`) remembers it. Leads go by page, not by site: a directory points at one call, which
 * may be new on a site we already list.
 *   bun scripts/refresh/discover-directories.ts [--no-issue]
 * To watch another directory, add it to DIRECTORIES and its host to NOT_FUNDERS (discover-web.ts).
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import { bareUrl, DISCOVERED_PATH, fileDiscoveryIssue, writeDiscovered, type Discovered } from './discover'
import { isNotFunder, isShared, siteOf } from './discover-web'
import { fetchRaw } from './fetch'
import { readJson } from './state'
import { dateOf } from './tier'

export type Directory = {
  name: string
  url: string
  /** One element per listed call, its title and its link to the funder, as CSS selectors. */
  card: string
  title: string
  link: string
}

export const DIRECTORIES: Directory[] = [
  {
    name: 'Climate and Environment Charter for Humanitarian Organizations',
    url: 'https://www.climate-charter.org/funding-opportunities/',
    card: '.funding-item',
    title: 'h3',
    link: 'a.funding-link',
  },
]

/** EU portal pages are search results, and discover.ts reads that portal's own API daily. */
const COVERED_BY_API = ['ec.europa.eu']

export type Card = { title: string; url: string }

/** Every call card on the directory page. Links inside a card's own text are not calls, so only `link` counts. */
export function cardsOf(html: string, d: Directory): Card[] {
  const { document } = parseHTML(html)
  return [...document.querySelectorAll(d.card)].flatMap((card) => {
    const href = card.querySelector(d.link)?.getAttribute('href')
    const title = card.querySelector(d.title)?.textContent?.replace(/\s+/g, ' ').trim()
    return href && title && URL.canParse(href, d.url) ? [{ title, url: new URL(href, d.url).href }] : []
  })
}

/** `knownSite`: the data or an earlier lead already has another page of this funder's site. */
export type DirectoryLead = Card & { key: string; directory: string; knownSite: boolean }

/** One lead per funder page, skipping other directories and pages the data cites or an earlier run raised. */
export function directoryLeads(cards: (Card & { directory: string })[], known: Discovered, dataUrls: string[]): DirectoryLead[] {
  const pages = [...dataUrls, ...Object.values(known).map((k) => k.url)].filter((u) => URL.canParse(u))
  const knownPages = new Set(pages.map(bareUrl))
  const knownSites = new Set(pages.map((u) => new URL(u).host).filter((h) => !isShared(h)).map(siteOf))
  const leads = new Map<string, DirectoryLead>()
  for (const card of cards) {
    const { host, protocol } = new URL(card.url)
    const key = `dir:${bareUrl(card.url)}`
    if (!/^https?:$/.test(protocol) || isNotFunder(host) || COVERED_BY_API.includes(host)) continue
    if (known[key] || knownPages.has(bareUrl(card.url)) || leads.has(key)) continue
    leads.set(key, { ...card, key, knownSite: !isShared(host) && knownSites.has(siteOf(host)) })
  }
  return [...leads.values()]
}

function row(l: DirectoryLead): string {
  const cell = (s: string) => s.replace(/[[\]|]/g, '\\$&').slice(0, 120)
  return `| [${cell(l.title)}](${l.url}) | ${cell(new URL(l.url).host.replace(/^www\./, ''))} | ${l.knownSite ? 'yes' : '—'} | ${cell(l.directory)} |`
}

if (import.meta.main) {
  const today = dateOf(new Date())
  const errors: string[] = []
  const cards: (Card & { directory: string })[] = []
  for (const d of DIRECTORIES) {
    const raw = await fetchRaw(d.url)
    const found = raw.ok ? cardsOf(raw.body, d) : []
    if (!raw.ok) errors.push(`${d.name}: ${raw.message}`)
    else if (!found.length) errors.push(`${d.name}: no cards found, so its layout changed; fix its selectors in DIRECTORIES`)
    cards.push(...found.map((c) => ({ ...c, directory: d.name })))
  }

  const programmesDir = join(process.cwd(), 'data', 'programmes')
  const dataText = [readFileSync(join(process.cwd(), 'data', 'sources.json'), 'utf8'), ...readdirSync(programmesDir).map((f) => readFileSync(join(programmesDir, f), 'utf8'))].join('\n')
  const dataUrls = [...new Set(dataText.match(/https?:\/\/[^\s"'<>]+/g) ?? [])].filter((u) => URL.canParse(u))
  const known = readJson<Discovered>(DISCOVERED_PATH) ?? {}
  const fresh = directoryLeads(cards, known, dataUrls)

  const body = [
    `Directory discovery ${today}: ${cards.length} calls on ${DIRECTORIES.length} watched ${DIRECTORIES.length === 1 ? 'directory' : 'directories'}, ${fresh.length} new (page not cited and not raised before).`,
    '',
    "Each row is a tip for where to look, not a listing: the directory's own deadlines and amounts can be wrong and are left out. Read the funder's page and add a programme from it with quotes only if it passes `docs/triage-criteria.md`. **Site known** means we list or already raised another page of that site.",
    '',
    '| Call | Site | Site known | Directory |',
    '| --- | --- | --- | --- |',
    ...fresh.map(row),
    ...(errors.length ? ['', '### Not read', ...errors.map((e) => `- ${e}`)] : []),
  ].join('\n')
  console.log(body)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)

  if (!process.argv.includes('--no-issue') && fresh.length) {
    const issue = fileDiscoveryIssue(`Directory discovery ${today}: ${fresh.length} calls to review`, body)
    for (const l of fresh) known[l.key] = { title: l.title, url: l.url, deadline: null, first_seen: today, issue }
    writeDiscovered(known)
  }
  if (errors.length) process.exit(1)
}
