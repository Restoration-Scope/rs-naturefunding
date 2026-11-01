import { loadProgrammes } from '../data/load'
import type { Call, Evidence, Programme } from '../data/schema'
import { countryRegion } from './geo'
import type { SizeBucket, State } from './labels'
import { sizeBuckets } from './labels'

export const programmes: Programme[] = loadProgrammes()

/** The day this build ran, in UTC. Statuses and freshness are judged against it, and again in the browser. */
export const buildDate = new Date().toISOString().slice(0, 10)

export const AGING_DAYS = 30
export const HIDDEN_DAYS = 90

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

export type Listing = {
  p: Programme
  state: State
  /** The call that sets the state: the open call closing soonest, else the next upcoming one, else the latest closed one. */
  call: Call | null
  ageDays: number
  aging: boolean
}

const byDeadline = (a: Call, b: Call) => (a.deadline?.date ?? '9999').localeCompare(b.deadline?.date ?? '9999')

export function listingFor(p: Programme, today = buildDate): Listing {
  const ageDays = daysBetween(p.checked_at, today)
  const base = { p, ageDays, aging: ageDays > AGING_DAYS }
  if (p.access === 'intermediary' || p.access === 'invitation_only') return { ...base, state: 'none', call: null }

  const open = p.calls.filter((c) => c.status === 'open' && !(c.deadline && c.deadline.date < today)).sort(byDeadline)
  // An open call with no deadline is rolling only when the funder says so; otherwise it is open with an undated window.
  if (open[0]) return { ...base, state: p.window === 'rolling' ? 'rolling' : 'open', call: open[0] }

  const upcoming = p.calls
    .filter((c) => c.status === 'upcoming')
    .sort((a, b) => (a.opens ?? '9999').localeCompare(b.opens ?? '9999'))
  if (upcoming[0]) return { ...base, state: 'upcoming', call: upcoming[0] }

  // Yearly windows where the page doesn't say whether one is open now: no open call, but the dates are worth showing.
  const recurring = p.calls.find((c) => c.status === 'unknown' && c.recurring)
  if (recurring) return { ...base, state: 'none', call: recurring }

  const past = [...p.calls].sort(byDeadline).reverse()
  if (past[0]) return { ...base, state: 'closed', call: past[0] }
  return { ...base, state: 'none', call: null }
}

/** Every programme the finder shows: checked within the last 90 days. */
export const listings: Listing[] = programmes
  .map((p) => listingFor(p))
  .filter((l) => l.ageDays <= HIDDEN_DAYS)

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

/** Rough US dollars per unit, only to sort amounts into size buckets. Amounts are always shown as the funder wrote them. */
const usdPerUnit: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.13, CAD: 0.73, AUD: 0.66, NZD: 0.6, JPY: 0.0067, NOK: 0.093, SEK: 0.095,
  DKK: 0.145, BRL: 0.18, MXN: 0.055, INR: 0.012, ZAR: 0.055, KES: 0.0078, CNY: 0.14, SGD: 0.75, HKD: 0.13,
}

export function sizeBucketsFor(p: Programme): SizeBucket[] {
  const rate = p.amount && usdPerUnit[p.amount.currency]
  if (!p.amount || !rate) return []
  const lo = (p.amount.min ?? 0) * rate
  const hi = (p.amount.max ?? Infinity) * rate
  return (Object.entries(sizeBuckets) as [SizeBucket, { min: number; max: number }][])
    .filter(([, b]) => lo < b.max && hi >= b.min)
    .map(([k]) => k)
}

/** Space-separated codes a programme is open to: `*` everywhere, `R:<region>` a whole region, else its countries plus `r:<region>` of each. */
export function whereCodes(p: Programme): string {
  const g = p.geography
  if (!g) return ''
  if (g.scope === 'global') return '*'
  if (g.scope === 'regions') return g.regions.map((r) => `R:${r}`).join(' ')
  const regions = new Set(g.countries.map((c) => countryRegion[c]).filter(Boolean))
  return [...g.countries, ...[...regions].map((r) => `r:${r}`)].join(' ')
}

export const stats = {
  programmes: listings.length,
  openCalls: listings.filter((l) => l.state === 'open' || l.state === 'rolling').length,
  open: listings.filter((l) => l.state === 'open').length,
  rolling: listings.filter((l) => l.state === 'rolling').length,
  lastChecked: listings.map((l) => l.p.checked_at).sort().at(-1) ?? null,
}

export type SharedSource = { url: string; checked: string }

/** The page and date most of these facts were checked against, when at least two share them. */
export function sharedSource(evidence: (Evidence | undefined)[]): SharedSource | null {
  const counts = new Map<string, number>()
  for (const e of evidence) if (e) counts.set(`${e.checked_at} ${e.source_url}`, (counts.get(`${e.checked_at} ${e.source_url}`) ?? 0) + 1)
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  if (!top || top[1] < 2) return null
  const [checked, url] = top[0].split(' ')
  return { url: url!, checked: checked! }
}
