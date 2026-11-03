/**
 * Daily discovery of new nature-based-solutions calls from two public APIs: the EU Funding &
 * Tenders search (topics filtered by code, not text) and grants.gov (filtered by agency, then by
 * NbS terms in the title). Each call not yet listed or posted becomes a row in one
 * review issue (label discovery) with the call's own page and a verbatim quote of the API text;
 * nothing is added to data/programmes and nothing merges by itself. What was posted is kept in
 * data/checks/discovered.json so each call is raised once.
 *   bun scripts/refresh/discover.ts [--no-issue]
 * EU_SEARCH_API_KEY must be set for the EU source; without it the EU half is skipped.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { USER_AGENT } from './fetch'
import { CHECKS_DIR, readJson, writeJson } from './state'
import { dateOf } from './tier'

export const DISCOVERED_PATH = join(CHECKS_DIR, 'discovered.json')

export type Candidate = {
  /** `eu:<topic identifier>` or `us:<grants.gov opportunity number>`. */
  key: string
  source: 'eu' | 'us'
  id: string
  title: string
  funder: string
  url: string
  /** Earliest deadline still ahead (YYYY-MM-DD), or null when the API gives none. */
  deadline: string | null
  status: string
  /** Verbatim text from the API, which is the text the call page shows. */
  quote: string
  /** Who can apply as the lead, in a few words. */
  lead: string
  note: string | null
}

export type Discovered = Record<string, { title: string; url: string; deadline: string | null; first_seen: string; issue: string | null }>

const EU_TOPIC_PAGE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/'
const US_PAGE = 'https://www.grants.gov/search-results-detail/'

/** EU topics by code: nature calls always; adaptation, communities and food-system calls only when the text is about NbS. */
export function isNbsEuTopic(identifier: string, text: string): boolean {
  if (/^HORIZON-NATURE-/.test(identifier) || /^HORIZON-CL6-.*-BIODIV-/.test(identifier)) return true
  if (/^LIFE-.*-NAT(-|$)/.test(identifier)) return true
  if (/^LIFE-.*-CLIMA-CCA/.test(identifier)) return /nature-based|ecosystem-based|\bNbS\b/i.test(text)
  if (/^HORIZON-CL6-.*-(COMMUNITIES|FARM2FORK)-/.test(identifier)) return /restor|nature-based|\bNbS\b|agroforest/i.test(text)
  return false
}

/** US agencies whose calls fund work on the land and water itself (search2 codes; the DOI parent code matches nothing). */
export const US_AGENCIES = ['DOI-FWS', 'DOI-BLM', 'DOI-NPS', 'DOI-BOR', 'DOC-DOCNOAAERA', 'USDA-FS', 'USDA-NRCS', 'EPA']

const NBS_TERMS = /\b(restor\w*|habitat\w*|wetlands?|coral|reefs?|watersheds?|invasive|ecosystems?|fish passage|endangered species|mangroves?|riparian|grasslands?|prairies?|reforest\w*|forests?|estuar\w*|living shorelines?|marsh\w*|pollinators?|biodiversity|conservation easements?)\b/i
const NOT_NBS = /\b(internships?|tourism|recreation|desalination|reuse|compensation|rescue|fire response|fire science|business plan|research act|cooperative ecosystems? studies|affiliated partner|broad agency announcement)\b/i

/** The title decides: synopses of broad announcements (BAAs, education, gear research) mention habitats in passing. */
export function isNbsUsOpportunity(title: string): boolean {
  return !NOT_NBS.test(title) && NBS_TERMS.test(title)
}

/** grants.gov applicant type codes for governments (state, county, city, special district, school district, tribal, housing). */
const GOVERNMENT = new Set(['00', '01', '02', '04', '05', '07', '08'])
const INDIVIDUALS = '21'
const LEAD_LABELS: Record<string, string> = {
  '99': 'anyone', '12': 'nonprofits', '13': 'nonprofits', '11': 'tribal organisations', '20': 'universities', '06': 'universities',
  '22': 'businesses', '23': 'businesses', '25': 'see the call text',
}

/**
 * The audience rule: a programme is listed only if an organisation can apply as the project lead,
 * so calls open only to governments or to individuals (farmers, landowners, students) are dropped.
 * Returns who can lead, or null when no organisation can.
 */
export function organisationLead(applicantTypes: string[]): string | null {
  const orgs = applicantTypes.filter((t) => !GOVERNMENT.has(t) && t !== INDIVIDUALS)
  if (!orgs.length) return null
  if (orgs.includes('99')) return 'anyone'
  return [...new Set(orgs.map((t) => LEAD_LABELS[t] ?? 'other organisations'))].join(', ')
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ')
    .trim()
}

/** The opening sentences of the text, up to about `max` characters, cut at a sentence end. */
export function quoteFrom(text: string, max = 300): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

/** grants.gov dates come as MM/DD/YYYY. */
export function usDate(mdy: string | undefined): string | null {
  const m = mdy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null
}

/** Calls not yet raised and not already in data/ (matched by topic code or opportunity number). */
export function newCandidates(found: Candidate[], known: Discovered, dataText: string): Candidate[] {
  const seen = new Set<string>()
  return found.filter((c) => {
    if (seen.has(c.key) || known[c.key] || dataText.includes(c.id)) return false
    seen.add(c.key)
    return true
  })
}

async function euCandidates(key: string, today: string): Promise<Candidate[]> {
  const query = { bool: { must: [{ terms: { type: ['1', '2'] } }, { terms: { status: ['31094501', '31094502'] } }] } }
  const out: Candidate[] = []
  for (let page = 1; page <= 50; page++) {
    const form = new FormData()
    form.append('query', new Blob([JSON.stringify(query)], { type: 'application/json' }))
    form.append('languages', new Blob([JSON.stringify(['en'])], { type: 'application/json' }))
    // Without a sort the pages overlap and skip topics from one request to the next.
    form.append('sort', new Blob([JSON.stringify({ field: 'identifier', order: 'ASC' })], { type: 'application/json' }))
    const res = await fetch(`https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=${encodeURIComponent(key)}&text=***&pageSize=100&pageNumber=${page}`, {
      method: 'POST', body: form, headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`EU search: HTTP ${res.status}`)
    // The API puts raw control characters inside its strings.
    const json = JSON.parse((await res.text()).replace(/[\u0000-\u001f]/g, ' ')) as { results: { metadata?: Record<string, string[]> }[] }
    for (const r of json.results) {
      const m = r.metadata ?? {}
      const id = m.identifier?.[0]
      if (!id) continue
      const text = plainText(m.descriptionByte?.[0] ?? '')
      if (!isNbsEuTopic(id, text)) continue
      // The status field lags; the deadline decides.
      const deadline = (m.deadlineDate ?? []).map((d) => d.slice(0, 10)).filter((d) => d >= today).sort()[0] ?? null
      if (!deadline) continue
      out.push({
        key: `eu:${id}`, source: 'eu', id, title: plainText(m.title?.[0] ?? id), funder: `European Commission (${m.callIdentifier?.[0] ?? id.replace(/-\d+$/, '')})`,
        url: m.url?.[0] ?? `${EU_TOPIC_PAGE}${id}`, deadline, status: m.status?.[0] === '31094501' ? 'forecast' : 'open',
        quote: quoteFrom(text.replace(/^Expected Outcome:\s*/i, '')),
        lead: id.startsWith('HORIZON-') ? 'EU-led consortium' : 'see the call text',
        note: id.startsWith('HORIZON-') ? 'Horizon Europe: the applicant must be a consortium led from the EU (a `consortium_required` flag in the schema when the first one is added; access stays `direct`).' : null,
      })
    }
    if (json.results.length < 100) break
  }
  return out
}

type UsHit = { id: string; number: string; title: string; agency: string; agencyCode: string; closeDate: string; oppStatus: string }

async function usCandidates(today: string): Promise<Candidate[]> {
  const post = async <T>(path: string, body: object): Promise<T> => {
    const res = await fetch(`https://api.grants.gov/v1/api/${path}`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`grants.gov ${path}: HTTP ${res.status}`)
    return ((await res.json()) as { data: T }).data
  }
  const out: Candidate[] = []
  for (const agency of US_AGENCIES) {
    const { oppHits } = await post<{ oppHits: UsHit[] }>('search2', { agencies: agency, oppStatuses: 'forecasted|posted', rows: 100 })
    for (const h of oppHits ?? []) {
      const deadline = usDate(h.closeDate)
      if (deadline && deadline < today) continue
      const title = plainText(h.title)
      if (!isNbsUsOpportunity(title)) continue
      const { synopsis } = await post<{ synopsis?: { synopsisDesc?: string; applicantTypes?: { id: string }[] } }>('fetchOpportunity', { opportunityId: Number(h.id) })
      const lead = organisationLead((synopsis?.applicantTypes ?? []).map((t) => t.id))
      if (!lead) continue
      const text = plainText(synopsis?.synopsisDesc ?? '')
      out.push({
        key: `us:${h.number}`, source: 'us', id: h.number, title, funder: plainText(h.agency), url: `${US_PAGE}${h.id}`,
        deadline, status: h.oppStatus, quote: quoteFrom(text || title), lead,
        note: 'United States: geography `{ "scope": "countries", "countries": ["US"] }`. Calls open only to governments or individuals are left out.',
      })
    }
  }
  return out
}

function row(c: Candidate): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|')
  return `| [${cell(c.id)}](${c.url}) | ${cell(c.title)} | ${cell(c.funder)} | ${c.deadline ?? '—'} (${c.status}) | ${cell(c.lead)} | “${cell(c.quote)}” |`
}

if (import.meta.main) {
  const now = new Date()
  const today = dateOf(now)
  const errors: string[] = []
  const found: Candidate[] = []
  const euKey = process.env.EU_SEARCH_API_KEY?.trim()
  if (euKey) await euCandidates(euKey, today).then((c) => found.push(...c), (e) => errors.push(`EU: ${(e as Error).message}`))
  else errors.push('EU: EU_SEARCH_API_KEY is not set, so EU topics were not searched')
  await usCandidates(today).then((c) => found.push(...c), (e) => errors.push(`US: ${(e as Error).message}`))

  const programmesDir = join(process.cwd(), 'data', 'programmes')
  const dataText = [readFileSync(join(process.cwd(), 'data', 'sources.json'), 'utf8'), ...readdirSync(programmesDir).map((f) => readFileSync(join(programmesDir, f), 'utf8'))].join('\n')
  const known = readJson<Discovered>(DISCOVERED_PATH) ?? {}
  const fresh = newCandidates(found, known, dataText).sort((a, b) => a.source.localeCompare(b.source) || (a.deadline ?? '9').localeCompare(b.deadline ?? '9'))

  const body = [
    `Discovery ${today}: ${found.length} NbS calls open or forecast in the two APIs, ${fresh.length} new (not listed and not raised before).`,
    '',
    'Each row is a lead, not a listing: add it as a programme or call only after reading the call page and quoting it, like every other row, and only if an organisation can apply as the project lead (no farmer or landowner payments, student grants or public-agency-only grants). Quotes are the API text the call page shows.',
    ...(['eu', 'us'] as const).flatMap((src) => {
      const rows = fresh.filter((c) => c.source === src)
      if (!rows.length) return []
      const notes = [...new Set(rows.map((c) => c.note).filter(Boolean))]
      return ['', src === 'eu' ? '### EU Funding & Tenders' : '### grants.gov (United States)', ...notes.map((n) => `_${n}_`), '', '| Call | Title | Funder | Deadline | Who can lead | Quote |', '| --- | --- | --- | --- | --- | --- |', ...rows.map(row)]
    }),
    ...(errors.length ? ['', '### Not searched', ...errors.map((e) => `- ${e}`)] : []),
  ].join('\n')
  console.log(body)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)

  if (!process.argv.includes('--no-issue')) {
    const issue = fresh.length ? fileDiscoveryIssue(`Discovery ${today}: ${fresh.length} new NbS calls to review`, body) : null
    for (const c of fresh) known[c.key] = { title: c.title, url: c.url, deadline: c.deadline, first_seen: today, issue }
    writeDiscovered(known)
  }
  if (errors.length && !found.length) process.exit(1)
}

/** Opens one review issue under the discovery label and returns its URL. */
export function fileDiscoveryIssue(title: string, body: string): string {
  mkdirSync('.cache', { recursive: true })
  const file = join('.cache', 'discovery-body.md')
  writeFileSync(file, body)
  Bun.spawnSync(['gh', 'label', 'create', 'discovery', '--color', '5319e7', '--force'])
  const made = Bun.spawnSync(['gh', 'issue', 'create', '--title', title, '--label', 'discovery', '--body-file', file])
  if (made.exitCode !== 0) throw new Error(`gh issue create failed: ${made.stderr.toString()}`)
  const issue = made.stdout.toString().trim()
  console.log(issue)
  return issue
}

export function writeDiscovered(known: Discovered) {
  writeJson(DISCOVERED_PATH, Object.fromEntries(Object.entries(known).sort(([a], [b]) => a.localeCompare(b))))
}
