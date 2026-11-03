/**
 * Weekly discovery of funders we don't list yet, by web search (Exa). The two APIs in discover.ts
 * only see the EU and US governments; this finds foundations, national funds, regional councils
 * and companies by region, theme and language. Each funder site not yet listed or raised becomes
 * a row in one review issue (label discovery). A row is a tip for where to look, like a directory:
 * nothing is taken from Exa's result, and a listing is added only from the funder's own page.
 * Raised sites go into data/checks/discovered.json (keys `web:`) so each comes up once.
 *   bun scripts/refresh/discover-web.ts [--no-issue]
 * EXA_API_KEY must be set; about $0.02 a search, so a run of the searches below is about $0.50.
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DISCOVERED_PATH, fileDiscoveryIssue, writeDiscovered, type Discovered } from './discover'
import { readJson } from './state'
import { dateOf } from './tier'

const CALL = "A funder's own page for a grant programme or call for proposals that pays NGOs or community groups for"

/** Lanes by region, by theme and by language, so one week's run covers the whole map once. */
export const SEARCHES = [
  `${CALL} nature conservation or restoration in Africa`,
  `${CALL} nature conservation or restoration in South or Southeast Asia`,
  `${CALL} nature conservation or restoration in the Pacific islands, Australia or New Zealand`,
  `${CALL} nature conservation or restoration in Latin America or the Caribbean`,
  `${CALL} nature conservation or restoration in Europe`,
  `${CALL} nature conservation or restoration in the United States or Canada`,
  `${CALL} nature conservation or restoration in the Middle East, Central Asia or the Mediterranean`,
  `${CALL} forest landscape restoration or tree planting`,
  `${CALL} mangrove, seagrass or coastal wetland restoration`,
  `${CALL} river, wetland or peatland restoration`,
  `${CALL} marine protected areas or coral reef restoration`,
  `${CALL} grassland, savanna or dryland restoration`,
  `${CALL} threatened species conservation, small grants for field projects`,
  `${CALL} agroforestry or regenerative land use with smallholders`,
  `${CALL} community-led conservation by Indigenous peoples and local communities`,
  'Convocatoria de una fundación o fondo para proyectos de restauración ecológica o conservación de la biodiversidad',
  'Edital de fundo ou fundação para projetos de restauração ecológica ou conservação da biodiversidade',
  "Appel à projets d'une fondation ou collectivité pour la restauration des écosystèmes ou la biodiversité",
  'Förderprogramm einer Stiftung für Naturschutzprojekte oder Renaturierung von Lebensräumen',
  'Bando di una fondazione per progetti di tutela della biodiversità o ripristino degli ecosistemi',
  '自然保護や生物多様性保全の活動を行う団体への助成金の公募',
  'Hibah atau dana untuk organisasi masyarakat yang melakukan konservasi atau restorasi ekosistem',
]

const OBJECTIVE =
  'Pages run by the funder itself (foundation, government agency, fund, company) describing a grant programme or call ' +
  'for proposals for nature conservation or restoration, with eligibility, amounts or deadlines. Exclude grant ' +
  'directories, news articles, blog roundups, aggregators and pages listing awarded projects.'

/** Directories, aggregators and news sites that list other funders' calls: never a funder's own page. */
export const NOT_FUNDERS = [
  'fundsforngos.org', 'terravivagrants.org', 'restor.eco', 'biofin.org', 'grantwatch.com', 'openforests.com', 'devex.com',
  'instrumentl.com', 'opportunitydesk.org', 'developmentaid.org', 'grantedai.com', 'ngoportal.org', 'africanngos.org',
  'insidephilanthropy.com', 'ngofunds.in', 'compassid.org', 'triple-funds.com', 'restorationfunders.com', 'fundopp.uci.edu',
  'africadslive.com', 'rsnonline.org.uk', 'tridge.com', 'fundingforgood.org', 'candid.org', 'grantforward.com',
  'aides-territoires.beta.gouv.fr', 'conjunta.org', 'fundingopportunitis.com', 'granter.it', 'invenyo.it', 'innovationbridge.info',
  'hojokin-agent.jp', 'jfc.or.jp', 'appelaprojets.org', 'eurovertice.eu', 'msmeafricaonline.com', 'togofirst.com', 'jiji.com',
  'uol.com.br', 'ots.at', 'insidestategovernment.com.au', 'medium.com', 'linkedin.com', 'facebook.com', 'x.com', 'youtube.com',
  'wikipedia.org', 'reddit.com',
]

/** GitHub refuses an issue body over 65,536 characters; rows past this wait for next week's run. */
const MAX_BODY = 60_000

/**
 * Sites that host many unrelated funders (governments, application platforms): a lead there is
 * the page, not the site, so a new programme on canada.ca is raised even though we list others.
 */
export const SHARED_SITES = [
  'gov.uk', 'canada.ca', 'gc.ca', 'gov.br', 'gov.au', 'govt.nz', 'europa.eu', 'undp.org', 'gouv.fr', 'gov.pl', 'gov.co',
  'gob.mx', 'go.jp', 'submittable.com', 'smapply.io', 'google.com',
]

/** The registrable part of a host: `fr.cepf.net` → `cepf.net`, `www.aucklandcouncil.govt.nz` → `aucklandcouncil.govt.nz`. */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.')
  const country = labels.length > 2 && /^[a-z]{2}$/.test(labels.at(-1)!) && /^(co|com|org|gov|govt|gob|gouv|ac|edu|net|or|go|ne)$/.test(labels.at(-2)!)
  return labels.slice(country ? -3 : -2).join('.')
}

const under = (host: string, sites: string[]) => sites.some((s) => host === s || host.endsWith(`.${s}`))
export const isShared = (host: string) => under(host.toLowerCase().replace(/^www\./, ''), SHARED_SITES)
export const isNotFunder = (host: string) => under(host.toLowerCase().replace(/^www\./, ''), NOT_FUNDERS)

/** A URL without scheme, `www.`, query, hash or trailing slash, for matching against the data. */
export const bareUrl = (url: string) => {
  const u = new URL(url)
  return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase()
}

export type Hit = { title: string; url: string; publishedDate?: string | null }

export type Lead = { key: string; site: string; title: string; url: string; searches: number; published: string | null }

/**
 * One lead per funder site (per page on a shared site), skipping directories, sites the data
 * already cites and leads raised before. `searches` counts how many searches found it: the more,
 * the likelier it is a real funder of this kind.
 */
export function newLeads(hits: { hit: Hit; search: number }[], known: Discovered, dataUrls: string[]): Lead[] {
  const listedSites = new Set(dataUrls.map((u) => new URL(u).host).filter((h) => !isShared(h)).map(siteOf))
  const listedPages = new Set(dataUrls.map(bareUrl))
  const leads = new Map<string, Lead & { by: Set<number> }>()
  for (const { hit, search } of hits) {
    let url: URL
    try {
      url = new URL(hit.url)
    } catch {
      continue
    }
    if (isNotFunder(url.host)) continue
    const shared = isShared(url.host)
    const site = shared ? url.host.replace(/^www\./, '') : siteOf(url.host)
    const key = `web:${shared ? bareUrl(hit.url) : site}`
    if (known[key] || (shared ? listedPages.has(bareUrl(hit.url)) : listedSites.has(site))) continue
    const lead = leads.get(key) ?? { key, site, title: hit.title.replace(/\s+/g, ' ').trim() || site, url: hit.url, searches: 0, published: hit.publishedDate?.slice(0, 10) ?? null, by: new Set() }
    lead.by.add(search)
    lead.searches = lead.by.size
    leads.set(key, lead)
  }
  return [...leads.values()].map(({ by: _, ...lead }) => lead).sort((a, b) => b.searches - a.searches || a.site.localeCompare(b.site))
}

async function search(query: string, apiKey: string): Promise<Hit[]> {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, type: 'auto', numResults: 25, objective: OBJECTIVE, excludeDomains: NOT_FUNDERS }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ''}`)
  return ((await res.json()) as { results: Hit[] }).results.filter((r) => r.url)
}

function row(l: Lead): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').slice(0, 120)
  return `| ${cell(l.site)} | [${cell(l.title)}](${l.url}) | ${l.searches} | ${l.published ?? '—'} |`
}

if (import.meta.main) {
  const today = dateOf(new Date())
  const apiKey = process.env.EXA_API_KEY?.trim()
  if (!apiKey) {
    console.error('EXA_API_KEY is not set, so the web was not searched')
    process.exit(1)
  }
  const errors: string[] = []
  const hits: { hit: Hit; search: number }[] = []
  for (const [i, query] of SEARCHES.entries()) {
    await search(query, apiKey).then((found) => hits.push(...found.map((hit) => ({ hit, search: i }))), (e) => errors.push(`“${query}”: ${(e as Error).message}`))
  }

  const programmesDir = join(process.cwd(), 'data', 'programmes')
  const dataText = [readFileSync(join(process.cwd(), 'data', 'sources.json'), 'utf8'), ...readdirSync(programmesDir).map((f) => readFileSync(join(programmesDir, f), 'utf8'))].join('\n')
  const dataUrls = [...new Set(dataText.match(/https?:\/\/[^\s"'<>]+/g) ?? [])].filter((u) => URL.canParse(u))
  const known = readJson<Discovered>(DISCOVERED_PATH) ?? {}
  const found = newLeads(hits, known, dataUrls)
  const failed = errors.length ? ['', '### Searches that failed', ...errors.map((e) => `- ${e}`)].join('\n') : ''
  const head = (shown: number) => [
    `Web discovery ${today}: ${SEARCHES.length - errors.length} Exa searches found ${hits.length} pages; ${found.length} funder sites are new (not listed and not raised before)${shown < found.length ? `. The first ${shown} are below; the rest come up next week` : ''}.`,
    '',
    "Each row is a tip for where to look, not a listing, and many will be news posts or funders outside our scope. For each, find the funder's own call page and add a programme from it with quotes, like every other row, only if it funds nature work and an organisation can apply as the project lead. **Found by** counts the searches that returned the site; higher is likelier a fit.",
    '',
    '| Site | Page | Found by | Published |',
    '| --- | --- | --- | --- |',
  ].join('\n')
  const rows: string[] = []
  for (const lead of found) {
    if (head(found.length).length + failed.length + [...rows, row(lead)].join('\n').length + 1 > MAX_BODY) break
    rows.push(row(lead))
  }
  const fresh = found.slice(0, rows.length)
  const body = [head(fresh.length), ...rows].join('\n') + (failed ? `\n${failed}` : '')
  console.log(body)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)

  if (!process.argv.includes('--no-issue')) {
    const issue = fresh.length ? fileDiscoveryIssue(`Web discovery ${today}: ${fresh.length} possible funders to review`, body) : null
    for (const l of fresh) known[l.key] = { title: l.title, url: l.url, deadline: null, first_seen: today, issue }
    writeDiscovered(known)
  }
  if (errors.length === SEARCHES.length) process.exit(1)
}
