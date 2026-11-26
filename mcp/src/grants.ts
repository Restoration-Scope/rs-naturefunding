// What the tools answer, as plain functions over the programmes: no MCP, no I/O. Place, status and order come from
// the site's own pure modules (listing.ts, where-codes.ts), so a search here matches what the finder shows.
import type { Programme } from '../../src/data/schema'
import { approach, applicantType } from '../../src/data/schema'
import { amountText, geographyFull, geographyText } from '../../src/lib/format'
import { countryRegion, regionLabels, type Region } from '../../src/lib/geo'
import { accessLabels, approachLabels, applicantLabels, stateLabels } from '../../src/lib/labels'
import { HIDDEN_DAYS, listingFor, sortListings, type Listing } from '../../src/lib/listing'
import { absolute } from '../../src/lib/site'
import { whereCodes } from '../../src/lib/where-codes'
import { whereFit } from '../../src/lib/where-fit'

export type Approach = (typeof approach.options)[number]
export type ApplicantType = (typeof applicantType.options)[number]

/**
 * open: a call takes applications today (rolling included). worth_a_look (default): also announced calls and yearly
 * windows the funder's page doesn't date for this year. any: also closed and no-call programmes.
 */
export type StatusFilter = 'open' | 'worth_a_look' | 'any'

export type SearchInput = {
  query?: string
  approach?: Approach
  applicant_type?: ApplicantType
  /** ISO 3166-1 alpha-2, the country the work happens in. */
  country?: string
  region?: Region
  status?: StatusFilter
  limit?: number
  offset?: number
}

/** One line of a search result: enough to choose, with the page that holds the evidence. */
export type GrantSummary = {
  id: string
  name: string
  funder: string
  status: string
  deadline: string | null
  /** The date a call opens, when the funder gives one. */
  opens: string | null
  /** When the funder expects the next call, in its words ("June 2027"). */
  expected: string | null
  /** Yearly dates the funder gives without a year, in our words. */
  recurring: string | null
  amount: string | null
  where: string | null
  access: string
  checked_at: string
  page: string
  /** Filters this programme passed only because the funder doesn't say, or names a group the place may be in. */
  check?: string[]
  /** Query words found in this programme. */
  matched?: string[]
}

export const DEFAULT_LIMIT = 40
export const MAX_LIMIT = 100

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)

/** Words nearly every listing contains, so they can't tell programmes apart. */
const STOP = new Set(
  'a an and are as at be by for from in into is it of on or our the to we with grant grants fund funds funding funder project projects programme programmes program programs money apply application small large'.split(' '),
)

/** placeFit's codes, once per programme for the life of the Worker. */
const codeCache = new WeakMap<Programme, string[]>()
function codesOf(p: Programme): string[] {
  let c = codeCache.get(p)
  if (!c) codeCache.set(p, (c = whereCodes(p)))
  return c
}

/** The words a query can match, once per programme for the life of the Worker. */
const wordCache = new WeakMap<Programme, string[]>()
function wordsOf(p: Programme): string[] {
  let w = wordCache.get(p)
  if (!w) wordCache.set(p, (w = words(haystack(p))))
  return w
}

function haystack(p: Programme): string {
  return [p.name, p.funder.name, p.administered_by?.name, p.summary, ...p.approaches.map((a) => approachLabels[a]), geographyFull(p.geography)]
    .filter(Boolean)
    .join(' ')
}

/** A yearly window whose year the page doesn't give: no open call, but worth checking the dates. */
const hasWindow = (l: Listing) => l.state === 'none' && !!l.call?.recurring

const statusMatches: Record<StatusFilter, (l: Listing) => boolean> = {
  open: (l) => l.state === 'open' || l.state === 'rolling',
  worth_a_look: (l) => l.state === 'open' || l.state === 'rolling' || l.state === 'upcoming' || hasWindow(l),
  any: () => true,
}

function statusText(l: Listing): string {
  if (l.p.access === 'invitation_only') return 'Invitation only'
  if (l.p.access === 'intermediary') return 'Apply through a partner programme, not the funder'
  if (hasWindow(l)) return "Yearly windows; the funder's page doesn't say whether one is open now"
  return stateLabels[l.state]
}

export const pageUrl = (id: string) => absolute(`/p/${id}/`)
export const twinUrl = (id: string) => absolute(`/p/${id}.md`)

export function summarise(l: Listing): GrantSummary {
  const c = l.call
  return {
    id: l.p.id,
    name: l.p.name,
    funder: l.p.funder.name,
    status: statusText(l),
    deadline: c?.deadline ? `${c.deadline.date} (funder's words: "${c.deadline.text}")` : null,
    opens: c?.opens ?? null,
    expected: c?.expected ?? null,
    recurring: c?.recurring ?? null,
    amount: amountText(l.p.amount),
    where: geographyText(l.p.geography),
    access: accessLabels[l.p.access],
    checked_at: l.p.checked_at,
    page: pageUrl(l.p.id),
  }
}

/** Without the fields the funder doesn't give, so a long list stays short. */
const compact = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as Partial<T>

/** "KE" or "r:africa" from the input, '' for anywhere; null when the input names no known place. */
function whereOf(input: Pick<SearchInput, 'country' | 'region'>): string | null {
  const country = input.country?.toUpperCase()
  if (country) return Object.hasOwn(countryRegion, country) ? country : null
  if (input.region) return Object.hasOwn(regionLabels, input.region) ? `r:${input.region}` : null
  return ''
}

/**
 * The programmes the site lists (checked in the last 90 days) that match every filter. Programmes that match more
 * query words come first, then those with nothing to check, then the site's order: soonest deadline first.
 */
export type SearchResult = {
  total: number
  offset: number
  results: (Partial<GrantSummary> & Pick<GrantSummary, 'id'>)[]
  query_words?: string[]
  error?: string
}

export function searchGrants(programmes: Programme[], input: SearchInput, today: string | Date): SearchResult {
  const where = whereOf(input)
  if (where === null) return { total: 0, offset: 0, results: [], error: `Unknown place "${input.country ?? input.region}". Use an ISO 3166 two-letter country code or a region.` }
  const terms = [...new Set(input.query ? words(input.query) : [])].filter((t) => !STOP.has(t))
  const matches = programmes
    .flatMap((p) => {
      // Cheap filters first: the status needs dates in the funder's time zone, which costs the most.
      if (input.approach && !p.approaches.includes(input.approach)) return []
      const check: string[] = []
      if (input.applicant_type) {
        if (!p.applicant_types) check.push("applicant type: the funder's page doesn't say who can apply")
        else if (!p.applicant_types.includes(input.applicant_type)) return []
      }
      const matched = terms.length ? terms.filter((t) => wordsOf(p).some((w) => w.startsWith(t))) : []
      if (terms.length > 0 && matched.length === 0) return []
      const fit = where ? whereFit(codesOf(p), where, countryRegion[where]) : 'all'
      if (fit === null) return []
      if (fit === 'check') check.unshift('place: the funder names a group of countries this one may be in')
      const l = listingFor(p, today, where)
      if (l.ageDays > HIDDEN_DAYS || !statusMatches[input.status ?? 'worth_a_look'](l)) return []
      return [{ l, check, matched }]
    })
    .sort((a, b) => b.matched.length - a.matched.length || a.check.length - b.check.length || sortListings(a.l, b.l))

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(input.offset ?? 0, 0)
  const results = matches.slice(offset, offset + limit).map(({ l, check, matched }) => ({
    ...(compact(summarise(l)) as Partial<GrantSummary> & Pick<GrantSummary, 'id'>),
    ...(check.length > 0 && { check }),
    ...(terms.length > 0 && { matched }),
  }))
  return { total: matches.length, offset, results, ...(terms.length > 0 && { query_words: terms }) }
}

/** One programme as search shows it for a place ('' anywhere), plus its labels; null when the site doesn't list it. */
export function getGrant(programmes: Programme[], id: string, today: string | Date, place: Pick<SearchInput, 'country' | 'region'> = {}) {
  const p = programmes.find((x) => x.id === id)
  if (!p) return null
  const l = listingFor(p, today, whereOf(place) ?? '')
  if (l.ageDays > HIDDEN_DAYS) return null
  return {
    ...summarise(l),
    approaches: p.approaches.map((a) => approachLabels[a]),
    applicant_types: p.applicant_types?.map((a) => applicantLabels[a]) ?? null,
    partner_programmes: programmes.filter((c) => c.parent === p.id).map((c) => ({ id: c.id, name: c.name })),
  }
}
