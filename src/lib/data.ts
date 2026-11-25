import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadData } from '../data/load'
import type { Call, Programme } from '../data/schema'
import { areaCountries, countryName, countryRegion } from './geo'
import type { SizeBucket, State } from './labels'
import { sizeBuckets } from './labels'
import { usdPerUnit } from './rates'
import { daysBetween, effectiveCallStatus, utcDateKey } from './status'
import { callTakes, placeFit, wholeRegions, whereCodes } from './where-codes'

export { daysBetween } from './status'

const data = loadData()
export const programmes: Programme[] = data.programmes
/** Official country lists funders point to (data/lists), by id. */
export const countryLists = new Map(data.lists.map((l) => [l.id, l]))

/** The day this build ran, in UTC. Statuses and freshness are judged against it, and again in the browser. */
export const buildDate = utcDateKey()

export const AGING_DAYS = 30
export const HIDDEN_DAYS = 90

/** Why the daily check could not re-read a programme's pages, as the refresh job records it. */
export type RecheckFailure = 'robots' | 'blocked' | 'network' | 'http' | 'timeout' | 'selector' | 'unreadable'
// data/checks/programmes.json, written by each daily run. No file, or no entry, means no news.
const checksFile = join(process.cwd(), 'data', 'checks', 'programmes.json')
const checks: Record<string, { reason: RecheckFailure | null; failing_sources: string[] }> = existsSync(checksFile)
  ? JSON.parse(readFileSync(checksFile, 'utf8'))
  : {}
/** Set when the daily check could not re-read the programme's pages since `checked_at`. */
export const notRechecked = (id: string): RecheckFailure | null => checks[id]?.reason ?? null
const sourceUrl = new Map(data.sources.map((s) => [s.id, s.url]))
const failingPages = new Map(
  Object.values(checks).flatMap((c) => (c.reason ? c.failing_sources.map((id) => [sourceUrl.get(id), c.reason] as const) : [])),
)
/** Set when the daily check could not re-read this page, for the tags under each fact. */
export const notRecheckedPage = (url: string): RecheckFailure | null => failingPages.get(url) ?? null

export type Listing = {
  p: Programme
  /** The place whose calls set the state: "KE", "r:africa" or '' for every call. */
  where: string
  state: State
  /** The call that sets the state: the open call closing soonest, else the next upcoming one, else the latest closed one. */
  call: Call | null
  ageDays: number
  aging: boolean
}

const byDeadline = (a: Call, b: Call) => (a.deadline?.date ?? '9999').localeCompare(b.deadline?.date ?? '9999')

/**
 * The programme split by the call each country gets, when some call names its countries: countries whose calls
 * give the same state and call share a group. A programme open to whole regions adds the rest (`codes: null`),
 * which gets only the calls that name no country. Empty when every country would get the same.
 */
export function callGroups(p: Programme): { codes: string[] | null; listing: Listing }[] {
  if (!p.calls.some((c) => c.countries)) return []
  const g = p.geography
  const countries = [...new Set([...(g?.scope === 'countries' ? g.countries : []), ...p.calls.flatMap((c) => c.countries ?? [])])]
  const groups = new Map<string, { codes: string[]; listing: Listing }>()
  for (const k of countries) {
    const listing = listingFor(p, buildDate, k)
    const key = `${listing.state} ${listing.call?.id ?? ''}`
    const group = groups.get(key)
    if (group) group.codes.push(k)
    else groups.set(key, { codes: [k], listing })
  }
  const out: { codes: string[] | null; listing: Listing }[] = [...groups.values()].sort((a, b) => sortListings(a.listing, b.listing))
  if (g?.scope !== 'countries') out.push({ codes: null, listing: listingFor(p, buildDate, 'ZZ') }) // ZZ: a code no country has
  return out.length > 1 ? out : []
}

/** `where`: only the calls that take projects from it set the state. */
export function listingFor(p: Programme, today: string | Date = buildDate, where = ''): Listing {
  const now = typeof today === 'string' ? new Date(`${today}T12:00:00Z`) : today
  const todayKey = utcDateKey(now)
  const ageDays = daysBetween(p.checked_at, todayKey)
  const base = { p, where, ageDays, aging: ageDays > AGING_DAYS }
  if (p.access === 'intermediary' || p.access === 'invitation_only') return { ...base, state: 'none', call: null }
  const calls = p.calls.filter((c) => callTakes(c, where))
  const status = new Map(calls.map((c) => [c, effectiveCallStatus(c, now)]))

  const open = calls.filter((c) => status.get(c) === 'open').sort(byDeadline)
  // An open call with no deadline is rolling only when the funder says so; otherwise it is open with an undated window.
  if (open[0]) return { ...base, state: p.window === 'rolling' ? 'rolling' : 'open', call: open[0] }

  const upcoming = calls
    .filter((c) => status.get(c) === 'upcoming')
    .sort((a, b) => (a.opens ?? '9999').localeCompare(b.opens ?? '9999'))
  if (upcoming[0]) return { ...base, state: 'upcoming', call: upcoming[0] }

  // Yearly windows where the page doesn't say whether one is open now: no open call, but the dates are worth showing.
  const recurring = calls.find((c) => c.status === 'unknown' && c.recurring)
  if (recurring) return { ...base, state: 'none', call: recurring }

  const past = calls.filter((c) => status.get(c) === 'closed').sort(byDeadline).reverse()
  if (past[0]) return { ...base, state: 'closed', call: past[0] }
  return { ...base, state: 'none', call: null }
}

/** Every programme the finder shows: checked within the last 90 days. */
export const listings: Listing[] = programmes
  .map((p) => listingFor(p))
  .filter((l) => l.ageDays <= HIDDEN_DAYS)

/** An umbrella's partner programmes open now, of those sure to take projects in a Where. */
export const openPartners = (p: Programme, where = ''): Listing[] =>
  programmes
    .filter((c) => c.parent === p.id && placeFit(c, where) === 'all')
    .map((c) => listingFor(c, buildDate, where))
    .filter((l) => l.state === 'open' || l.state === 'rolling')

/** An umbrella's countries by how many partner programmes are open there; empty when none is open anywhere. */
export function partnerGroups(p: Programme): { codes: string[]; open: number }[] {
  if (p.access !== 'intermediary' || !openPartners(p).length) return []
  const groups = new Map<number, string[]>()
  for (const c of Object.keys(countryRegion).filter((k) => placeFit(p, k))) {
    const open = openPartners(p, c).length
    groups.set(open, [...(groups.get(open) ?? []), c])
  }
  return [...groups].map(([open, codes]) => ({ codes, open }))
}

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "mid-March 2027" → 2027-03-15, only to sort; the funder's wording is what we show. A bare year sorts at its end. */
export function expectedSortDate(text: string | undefined): string | undefined {
  const year = text?.match(/\b(20\d\d)\b/)?.[1]
  if (!text || !year) return undefined
  const m = monthNames.findIndex((n) => new RegExp(`\\b${n}`, 'i').test(text))
  if (m < 0) return `${year}-12-31`
  const day = text.match(/\b(\d{1,2})\b/)?.[1] ?? (/early/i.test(text) ? '5' : /mid/i.test(text) ? '15' : /late|end/i.test(text) ? '25' : '1')
  return `${year}-${String(m + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** When an upcoming call opens, for sorting: its date, else the funder's expected month or year. */
export const opensSortDate = (c: Call | null) => c?.opens ?? expectedSortDate(c?.expected)

const stateOrder: Record<State, number> = { open: 0, rolling: 1, upcoming: 2, none: 3, closed: 4 }

/** Soonest deadline first; rolling, upcoming (by opening date), no-call and closed after. */
export function sortListings(a: Listing, b: Listing) {
  const s = stateOrder[a.state] - stateOrder[b.state]
  if (s) return s
  const key = (l: Listing) =>
    l.state === 'upcoming' ? (opensSortDate(l.call) ?? l.call?.deadline?.date ?? '9999') : (l.call?.deadline?.date ?? '9999')
  // Closed calls: most recently closed first.
  const k = key(a).localeCompare(key(b)) * (a.state === 'closed' ? -1 : 1)
  return k || a.p.name.localeCompare(b.p.name)
}

export const programmeById = new Map(programmes.map((p) => [p.id, p]))

export function sizeBucketsFor(p: Programme): SizeBucket[] {
  const rate = p.amount && usdPerUnit[p.amount.currency]
  if (!p.amount || !rate) return []
  const lo = (p.amount.min ?? 0) * rate
  const hi = (p.amount.max ?? Infinity) * rate
  return (Object.entries(sizeBuckets) as [SizeBucket, { min: number; max: number }][])
    .filter(([, b]) => lo < b.max && hi >= b.min)
    .map(([k]) => k)
}

/** whereCodes with each whole region spelled out as its countries, so a page can tell whether it takes one country. */
export function whereReach(p: Programme): string {
  const g = p.geography
  const codes = whereCodes(p)
  if (g?.scope !== 'regions') return codes.join(' ')
  const whole = wholeRegions(g).flatMap(areaCountries).filter((c) => !g.except?.includes(c))
  return [...codes, ...whole].join(' ')
}

/**
 * The area a programme's country list stands for, for a page's "Includes" line. `part`: the label names an area
 * inside one country ("Yamanashi Prefecture" in Japan), so the page never says the whole country. `within`: the
 * label names the group or area its countries sit in ("Tropical Andes", "ODA-eligible countries").
 */
export function whereArea(p: Programme): { part?: string; within?: string } {
  const g = p.geography
  if (g?.scope !== 'countries' || !g.label || (g.whole && g.countries.length === 1)) return {}
  if (comparableName(g.label) === comparableName(g.countries.map(countryName).join(' '))) return {}
  return g.countries.length === 1 ? { part: g.label } : { within: g.label }
}

/** A place name with case, accents, "the", "and" and punctuation folded away, so "Hong Kong & Macau" matches "Hong Kong and Macau". */
const comparableName = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(the|and)\b|[^a-z]+/g, ' ').trim().split(/\s+/).sort().join(' ')

export const stats = {
  programmes: listings.length,
  openCalls: listings.filter((l) => l.state === 'open' || l.state === 'rolling').length,
  open: listings.filter((l) => l.state === 'open').length,
  rolling: listings.filter((l) => l.state === 'rolling').length,
  lastChecked: listings.map((l) => l.p.checked_at).sort().at(-1) ?? null,
}

