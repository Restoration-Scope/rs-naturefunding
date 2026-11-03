import { z } from 'zod'
import { deadlinePassed } from '../../scripts/refresh/deadline'
import { meaningfulQuote, MIN_QUOTE_CHARS } from './text'

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
/** Caps on free text, so a model's output can't carry a page-sized string into a listing. */
const name = z.string().min(1).max(200)
const url = z.url().max(500)

export const slug = z.string().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase-kebab-case')

/** Where a fact was read: the funder's own page, the exact words, and when. */
export const evidence = z.object({
  source_url: url,
  quote: z.string().max(400).refine(meaningfulQuote, `a quote needs at least ${MIN_QUOTE_CHARS} characters besides spaces`),
  checked_at: isoDate,
  method: z.enum(['page', 'api', 'human']),
})
export type Evidence = z.infer<typeof evidence>

export const approach = z.enum([
  'reforestation',
  'agroforestry',
  'natural_regeneration',
  'mangroves',
  'wetlands',
  'grasslands',
  'peatlands',
  'coastal_marine',
  'freshwater',
  'species_conservation',
  'protected_areas',
  'community_conservation',
  'sustainable_land_use',
  'urban_nature',
  'research',
])

export const applicantType = z.enum([
  'ngo',
  'community_group',
  'indigenous_organization',
  'research_institution',
  'individual',
  'government',
  'social_enterprise',
  'company',
])

/**
 * How an applicant reaches the money.
 * - direct: eligible applicants apply to an open call, run by the funder or its administrator.
 * - intermediary: no applications here; the money flows through partners (country programmes,
 *   accredited entities). Child programmes (`parent`) are the channels when we list them.
 * - invitation_only: the funder picks grantees and takes no unsolicited proposals.
 */
export const access = z.enum(['direct', 'intermediary', 'invitation_only', 'unspecified'])

/** How calls recur: fixed rounds with deadlines, or rolling (apply any time, no deadline). */
export const window = z.enum(['fixed', 'rolling', 'unspecified'])

export const callStatus = z.enum(['upcoming', 'open', 'closed', 'suspended', 'unknown'])

const iso2 = z.string().regex(/^[A-Z]{2}$/)

export const region = z.enum([
  'africa',
  'asia',
  'europe',
  'latin_america_caribbean',
  'middle_east',
  'north_america',
  'oceania',
])

export const deadline = z.object({
  date: isoDate,
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().max(64).optional(),
  /** The deadline as the funder wrote it. */
  text: z.string().min(3).max(200),
})

/**
 * One round of applications. A rolling programme has one standing call with no deadline.
 * `status` is as of `evidence.status.checked_at`.
 */
export const call = z.object({
  id: slug,
  label: name,
  url,
  status: callStatus,
  opens: isoDate.nullable(),
  deadline: deadline.nullable(),
  evidence: z.object({
    status: evidence,
    opens: evidence.optional(),
    deadline: evidence.optional(),
    recurring: evidence.optional(),
    countries: evidence.optional(),
  }),
  /** When the funder expects an upcoming call to open, as it says it ("June 2027", "mid-March 2027"). Firm dates go in `opens`. */
  expected: z.string().min(4).max(60).optional(),
  /** Dates the funder gives without a year, repeating each year, in our words. */
  recurring: z.string().min(5).max(200).optional(),
  /** A condition the funder puts on the call, in our words, from one of its quotes ("Subject to funding approval"). */
  note: z.string().min(3).max(200).optional(),
  /** The countries this call takes projects from, when narrower than the programme's ("Ecuador: first call"). Missing means all of them. */
  countries: z.array(iso2).min(1).optional(),
})
export type Call = z.infer<typeof call>

export const amount = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    min: z.number().positive().optional(),
    max: z.number().positive().optional(),
    /** The funder gives a usual range ("typically", "generally"), not hard limits. */
    typical: z.literal(true).optional(),
    /** The funder says "less than" the max, not "up to". */
    max_exclusive: z.literal(true).optional(),
    /** The amount is per year, not per grant. */
    per: z.enum(['year']).optional(),
    /** A qualifier from the same quote, in our words ("Up to £20,000 in total"). */
    note: z.string().min(3).max(200).optional(),
  })
  .refine((a) => a.min !== undefined || a.max !== undefined, 'amount needs min or max')
  .refine((a) => !a.max_exclusive || a.max !== undefined, 'max_exclusive needs a max')
  .refine((a) => !a.max_exclusive || a.min === undefined || a.max === undefined || a.min < a.max, 'less than max leaves no room above min')
  .refine((a) => a.min === undefined || a.max === undefined || a.min <= a.max, 'min is above max')

export const geography = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global') }),
  z.object({
    scope: z.literal('countries'),
    countries: z.array(iso2).min(1).max(250),
    /** Plain-language name of a region or hotspot the funder uses, e.g. "Tropical Andes". */
    label: name.optional(),
  }),
  /** Eligibility the funder states as a group, e.g. "ODA-eligible countries", with no country list. */
  z.object({
    scope: z.literal('regions'),
    regions: z.array(region).min(1),
    label: name.min(3),
  }),
])

const organisation = z.object({ name, url })

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`

/**
 * Whether a quote names the year of a date: "2026", or a short form that can only be a year:
 * "Nov '26" or "26 Nov '26" (the apostrophe right after a month), or "15/11/26". A bare "26" may
 * be the day ("closes 26 November"), and "'26 November'" is a quoted phrase, so neither counts.
 */
export const statesYear = (quote: string, date: string) => {
  const yy = date.slice(2, 4)
  return (
    quote.includes(date.slice(0, 4)) ||
    new RegExp(String.raw`\b${MONTH}\s*['‘’]${yy}(?![\d/'’]|\s*${MONTH}\b)`, 'i').test(quote) ||
    new RegExp(String.raw`\d{1,2}/\d{1,2}/${yy}(?![\d/])`).test(quote)
  )
}

/** Why a call's expected opening is wrong, or null: it is for an upcoming call with no firm date, and names only years its status quote states. */
export function expectedProblem(c: Pick<Call, 'expected' | 'status' | 'opens' | 'evidence'>): string | null {
  if (!c.expected) return null
  if (c.status !== 'upcoming' || c.opens) return 'an expected opening is for an upcoming call with no firm opens date'
  const years = c.expected.match(/\b20\d\d\b/g) ?? []
  if (years.length === 0 || !years.every((y) => statesYear(c.evidence.status.quote, `${y}-01-01`))) {
    return 'an expected opening names a year that its status quote states'
  }
  return null
}

/**
 * One funding programme. Each fact is stated on the funder's page (with its evidence)
 * or left null; null means "not stated", never "no restriction".
 */
export const programme = z
  .object({
    id: slug,
    name,
    funder: organisation,
    /** Who runs the call for the funder, e.g. a UNDP country office for a GEF SGP country programme. */
    administered_by: organisation.nullable(),
    /** The umbrella programme this one belongs to, e.g. `gef-sgp` for a country programme. */
    parent: slug.nullable(),
    url,
    /** Our own words, one or two sentences. Not copied from the funder. */
    summary: z.string().min(20).max(400),
    /** Our classification. A partnership pays for work under contract (planting partners), not a grant. Missing means grant. */
    kind: z.enum(['grant', 'partnership']).optional(),
    approaches: z.array(approach).min(1),
    applicant_types: z.array(applicantType).min(1).nullable(),
    geography: geography.nullable(),
    access,
    window,
    amount: amount.nullable(),
    co_finance_required: z.boolean().nullable(),
    /** The funder requires applicants to apply as a consortium of several organisations. Missing means not stated. */
    consortium_required: z
      .boolean()
      .optional()
      .describe('true when the funder requires applicants to apply as a consortium of several organisations; missing when the pages we read don’t say.'),
    /** What the funder asks grantees to report, in our words. */
    reporting: z.string().min(10).max(600).nullable(),
    calls: z.array(call).max(20),
    evidence: z.object({
      administered_by: evidence.optional(),
      applicant_types: evidence.optional(),
      geography: evidence.optional(),
      access: evidence.optional(),
      window: evidence.optional(),
      amount: evidence.optional(),
      co_finance_required: evidence.optional(),
      consortium_required: evidence.optional(),
      reporting: evidence.optional(),
    }),
    /** The oldest evidence date: every fact above was read on or after this day. */
    checked_at: isoDate,
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })

    const stated: Record<keyof typeof p.evidence, boolean> = {
      administered_by: p.administered_by !== null,
      applicant_types: p.applicant_types !== null,
      geography: p.geography !== null,
      access: p.access !== 'unspecified',
      window: p.window !== 'unspecified',
      amount: p.amount !== null,
      co_finance_required: p.co_finance_required !== null,
      consortium_required: p.consortium_required !== undefined,
      reporting: p.reporting !== null,
    }
    for (const [field, isStated] of Object.entries(stated)) {
      const e = p.evidence[field as keyof typeof p.evidence]
      if (isStated && !e) issue(['evidence', field], `${field} is stated but has no evidence`)
      if (!isStated && e) issue(['evidence', field], `${field} has evidence but is not stated`)
    }

    if (p.parent === p.id) issue(['parent'], 'a programme cannot be its own parent')
    if ((p.access === 'intermediary' || p.access === 'invitation_only') && p.calls.length > 0) {
      issue(['calls'], `${p.access} programmes take no applications, so they list no calls`)
    }

    const ids = new Set<string>()
    for (const [i, c] of p.calls.entries()) {
      const at = (...rest: (string | number)[]) => ['calls', i, ...rest]
      if (ids.has(c.id)) issue(at('id'), `duplicate call id ${c.id}`)
      ids.add(c.id)
      if (c.deadline && !c.evidence.deadline) issue(at('evidence', 'deadline'), 'deadline needs evidence')
      if (!c.deadline && c.evidence.deadline) issue(at('deadline'), 'deadline evidence without a deadline')
      if (c.opens && !c.evidence.opens) issue(at('evidence', 'opens'), 'opens needs evidence')
      if (!c.opens && c.evidence.opens) issue(at('opens'), 'opens evidence without an opens date')
      if (c.recurring && !c.evidence.recurring) issue(at('evidence', 'recurring'), 'recurring dates need evidence')
      if (!c.recurring && c.evidence.recurring) issue(at('recurring'), 'recurring evidence without recurring dates')
      const expected = expectedProblem(c)
      if (expected) issue(at('expected'), expected)
      if (c.countries && !c.evidence.countries) issue(at('evidence', 'countries'), 'call countries need evidence')
      if (!c.countries && c.evidence.countries) issue(at('countries'), 'countries evidence without call countries')
      const g = p.geography
      if (c.countries && g?.scope === 'countries') {
        const outside = c.countries.filter((k) => !g.countries.includes(k))
        if (outside.length) issue(at('countries'), `a call's countries sit inside the programme's; ${outside.join(', ')} is not`)
      }
      for (const [field, date] of [['opens', c.opens], ['deadline', c.deadline?.date]] as const) {
        const quote = c.evidence[field]?.quote
        if (date && quote && !statesYear(quote, date)) {
          issue(at(field), `the quote for ${date} does not state the year; a yearless date stays null`)
        }
      }
      if (p.window === 'rolling' && c.deadline) issue(at('deadline'), 'a rolling programme has no deadlines')
      if (c.opens && c.deadline && c.opens > c.deadline.date) issue(at('opens'), 'opens after the deadline')
      const seen = c.evidence.status.checked_at
      // Refresh stamps checked_at with the UTC day it read the page and closes a call once
      // deadlinePassed; so an open call is wrong only if its deadline had passed as that day began.
      if (c.status === 'open' && c.deadline && deadlinePassed(c.deadline, new Date(`${seen}T00:00:00Z`))) {
        issue(at('status'), `open, but the deadline ${c.deadline.date} passed before it was checked on ${seen}`)
      }
      if (c.status === 'upcoming' && c.opens && c.opens <= seen) {
        issue(at('status'), `upcoming, but it opened on ${c.opens}, before it was checked on ${seen}`)
      }
    }

    const allEvidence = [
      ...Object.values(p.evidence),
      ...p.calls.flatMap((c) => [c.evidence.status, c.evidence.opens, c.evidence.deadline, c.evidence.recurring, c.evidence.countries]),
    ].filter((e): e is Evidence => e !== undefined)
    for (const e of allEvidence) {
      if (e.checked_at < p.checked_at) issue(['checked_at'], `programme claims a check on ${p.checked_at}, but a fact was last read on ${e.checked_at}`)
    }
  })
export type Programme = z.infer<typeof programme>

/** A page the refresh job re-reads. Every evidence URL of a programme has a source. */
export const source = z.object({
  id: slug,
  programme_id: slug,
  url,
  /** CSS selector for the main text; null reads the whole body. */
  selector: z.string().min(1).nullable(),
  /** Where on the page the facts sit, for the extractor. */
  hint: z.string().nullable(),
  /** How often to re-read it. */
  cycle: z.enum(['daily', 'weekly', 'monthly']),
})
export type Source = z.infer<typeof source>
export const sources = z.array(source)
