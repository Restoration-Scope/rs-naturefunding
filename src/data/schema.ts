import { z } from 'zod'
import { deadlinePassed, parseZone } from '../lib/deadline'
import { meaningfulQuote, MIN_QUOTE_CHARS } from './text'
import { thresholdProblems } from './thresholds'

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

/**
 * What an eligibility rule asks of the applicant, our classification:
 * legal (status, registration, independence), track_record (years operating, past projects),
 * finances (revenue or turnover range, accounts, audits), capacity (staff, systems, policies),
 * project (the project's scope, size or partners), other.
 */
export const eligibilityKind = z.enum(['legal', 'track_record', 'finances', 'capacity', 'project', 'other'])

const currency = z.string().regex(/^[A-Z]{3}$/)

/** A revenue or budget range an applicant must fall in, per year, as an eligibility rule states it. */
export const revenueRange = z
  .object({
    currency: currency.describe('ISO 4217 code of the amounts.'),
    min: z.number().positive().optional().describe('The smallest yearly revenue or budget allowed.'),
    max: z.number().positive().optional().describe('The largest yearly revenue or budget allowed.'),
    basis: z.enum(['revenue', 'budget', 'expenditure']).describe('What the range is of: revenue (income, turnover), budget (the yearly operating budget) or expenditure (yearly spending).'),
    average_years: z.number().int().min(2).max(10).optional().describe('The range is an average over this many recent years.'),
  })
  .strict()
  .refine((r) => r.min !== undefined || r.max !== undefined, 'a revenue range needs min or max')
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, 'min is above max')

/** The largest request an applicant may make, as a share of its own yearly revenue or budget. */
export const requestCap = z
  .object({
    share: z.number().gt(0).max(1000).describe('The largest request, in percent of the applicant’s yearly revenue or budget: 100 means no more than one year’s revenue, 50 half of it.'),
    of: z.enum(['revenue', 'budget']).describe('What the cap is a share of: revenue (income, turnover) or budget.'),
  })
  .strict()

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
    /** The amount is per unit of work (a tree planted, a hectare restored), not per grant. */
    unit: z.enum(['tree', 'hectare']).optional(),
    /** A qualifier from the same quote, in our words ("Up to £20,000 in total"). */
    note: z.string().min(3).max(200).optional(),
  })
  .refine((a) => a.min !== undefined || a.max !== undefined, 'amount needs min or max')
  .refine((a) => !a.max_exclusive || a.max !== undefined, 'max_exclusive needs a max')
  .refine((a) => !a.max_exclusive || a.min === undefined || a.max === undefined || a.min < a.max, 'less than max leaves no room above min')
  .refine((a) => a.min === undefined || a.max === undefined || a.min <= a.max, 'min is above max')

/**
 * The total the funder puts behind a round, a year or the whole programme: all grants together,
 * not one grant. Only when the funder states it; missing means not stated.
 */
export const pool = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  value: z.number().positive(),
  /** What the total covers: one round of applications, one year, a two-year budget, or the programme over its life. */
  period: z.enum(['round', 'year', 'biennium', 'programme']),
  /**
   * up_to: the funder says "up to" the total. about: an approximation ("approximately", "around").
   * planned: not final ("indicative", "projected", "expected", "estimated").
   */
  qualifier: z.enum(['up_to', 'about', 'planned']).optional(),
  /** The round or years it is for, worded to follow "for" ("the 2026 round", "FY2027"). Missing reads as "a year", "per biennium", "for the round" or "over the programme". */
  label: z.string().min(3).max(60).optional(),
  /** A qualifier from the same quote, in our words ("Shared with the forestry window"). */
  note: z.string().min(3).max(200).optional(),
})
export type Pool = z.infer<typeof pool>

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
/** Full-width digits as ASCII, so "令和９年" reads like "令和9年". */
const asciiDigits = (s: string) => s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))

/**
 * The Japanese ways to write a year: "2027年" and the Reiwa era ("令和9年", 2019 is "令和元年"). A fiscal year
 * ("令和8年度") is not a calendar year, so it never counts.
 */
const japaneseYear = (y: string) => {
  const reiwa = Number(y) - 2018
  const era = reiwa === 1 ? '(?:元|1)' : reiwa > 1 ? String(reiwa) : null
  return String.raw`(?:${y}|${era ? String.raw`令和\s*${era}` : '(?!)'})\s*年(?!度)`
}

export const statesYear = (quote: string, date: string) => {
  const yy = date.slice(2, 4)
  return (
    quote.includes(date.slice(0, 4)) ||
    new RegExp(String.raw`(?<!\d)${japaneseYear(date.slice(0, 4))}`).test(asciiDigits(quote)) ||
    new RegExp(String.raw`\b${MONTH}\s*['‘’]${yy}(?![\d/'’]|\s*${MONTH}\b)`, 'i').test(quote) ||
    new RegExp(String.raw`\d{1,2}/\d{1,2}/${yy}(?![\d/])`).test(quote)
  )
}

const MONTHS = [
  ['jan', 'ene', 'janv', 'janeiro', 'jänner'],
  ['feb', 'fev', 'févr'],
  ['mar', 'mär'],
  ['apr', 'abr', 'avr'],
  ['may', 'mai', 'mayo', 'maio', 'mei'],
  ['jun', 'juin'],
  ['jul', 'juil'],
  ['aug', 'ago', 'août', 'aoû'],
  ['sept', 'sep', 'set'],
  ['oct', 'okt', 'out'],
  ['nov'],
  ['dec', 'dic', 'déc', 'dez'],
]
// Whole names short enough to sit in MONTHS: no dot may follow them ("8 May. 2027" ends a sentence).
const WHOLE_SHORT = new Set(['janeiro', 'jänner', 'may', 'mai', 'mayo', 'maio', 'mei', 'juin', 'août'])
const MONTH_NAMES: Record<number, string> = {
  1: 'januar[a-z]*|enero|janvier',
  2: 'februar[a-z]*|febrero|f[ée]vrier|fevereiro',
  3: 'march|marzo|mars|mar[çc]o|m[äa]rz|maart',
  4: 'april|abril|avril',
  6: 'june|junio|juin|junho|juni',
  7: 'july|julio|juillet|julho|juli',
  8: 'august|agosto|ao[ûu]t|augustus',
  9: 'september|septiembre|septembre|setembro',
  10: 'october|octubre|octobre|outubro|oktober',
  11: 'november|noviembre|novembre|novembro',
  12: 'december|diciembre|d[ée]cembre|dezembro|dezember',
}
/**
 * Whether a quote states a whole date: its day, its month (a name in English, Spanish, French, Portuguese,
 * German or Dutch, or a number) and its year in one expression. "January 8 for projects in 2027" is not 2027-01-08.
 * A numeric date with slashes or hyphens that reads two ways (08/01/2027) counts only when its order (DD/MM or
 * MM/DD) is stated next to it and the other order isn't; dots are day first (08.01.2027).
 */
export const statesDate = (quote: string, date: string) => {
  const [y, m, d] = [date.slice(0, 4), Number(date.slice(5, 7)), Number(date.slice(8))]
  if (!(m >= 1 && m <= 12)) return false
  const dd = String.raw`0?${d}`
  // "8." is a day only before its month ("8. Januar 2027"); after one, the dot ends a sentence.
  const day = String.raw`${dd}(?:st|nd|rd|th|er|º)?`
  const mm = String.raw`0?${m}`
  // Only an abbreviation takes a dot ("Jan. 8"): after a whole name ("8 January. 2027 projects") it ends a sentence.
  const short = MONTHS[m - 1]!
  const whole = [MONTH_NAMES[m], ...short.filter((a) => WHOLE_SHORT.has(a))].filter(Boolean).join('|')
  const name = String.raw`(?:${whole}|(?:${short.filter((a) => !WHOLE_SHORT.has(a)).join('|')})\.?)`
  const year = String.raw`(?:${y}|['‘’]${y.slice(2)})`
  const yy = String.raw`(?:${y}|${y.slice(2)})`
  const gap = String.raw`[\s,-]*(?:de\s+|of\s+)?`
  const alone = (f: string, flags = 'iu') => new RegExp(String.raw`(?<![\p{L}\d])(?:${f})(?![\p{L}\d])`, flags)
  const forms = [
    String.raw`${day}\.?${gap}${name}${gap}${year}`,
    String.raw`${name}\s*${day},?\s*${year}`,
    String.raw`${dd}\.${mm}\.${yy}`,
    String.raw`${y}[./-]${mm}[./-]${dd}`,
  ]
  if (alone(forms.join('|')).test(quote)) return true
  // "令和9年1月30日" or "2027年1月30日": kanji count as letters to alone(), so only digits bound these.
  if (new RegExp(String.raw`(?<!\d)${japaneseYear(y)}\s*0?${m}\s*月\s*0?${d}\s*日`).test(asciiDigits(quote))) return true
  const twoWays = d <= 12 && d !== m
  const DMY = /\b(?:dd|jj|tt)[/-]mm\b/i
  const MDY = /\bmm[/-]dd\b/i
  // Each match must carry its own order within a few words of its own sentence, so another field's format can't
  // vouch for it ("closes 08/01/2027. Birth date: DD/MM/YYYY.").
  const near = (re: RegExp, at: number, len: number) => {
    const before = quote.slice(Math.max(0, at - 40), at).split(/[.;!?\n]\s/).pop()!
    const after = quote.slice(at + len, at + len + 40).split(/[.;!?\n](?:\s|$)/)[0]!
    return re.test(`${before} ${after}`)
  }
  const numeric = (f: string, own: RegExp, other: RegExp) =>
    [...quote.matchAll(alone(f, 'giu'))].some((x) => !twoWays || (near(own, x.index, x[0].length) && !near(other, x.index, x[0].length)))
  return numeric(String.raw`${dd}[/-]${mm}[/-]${yy}`, DMY, MDY) || numeric(String.raw`${mm}[/-]${dd}[/-]${yy}`, MDY, DMY)
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
    /** The total funding behind the grants, when the funder states it. Missing means not stated. */
    pool: pool.optional(),
    co_finance_required: z.boolean().nullable(),
    /** The funder requires applicants to apply as a consortium of several organisations. Missing means not stated. */
    consortium_required: z
      .boolean()
      .optional()
      .describe('true when the funder requires applicants to apply as a consortium of several organisations; missing when the pages we read don’t say.'),
    /** What the funder asks grantees to report, in our words. */
    reporting: z.string().min(10).max(600).nullable(),
    /** What applying takes, in our words, from the funder's page. Missing means not stated. */
    effort: z
      .object({
        /** The steps in order, in our words ("Short expression of interest", "Full proposal"). */
        steps: z.array(z.string().min(3).max(80)).min(1).max(5).describe("The steps in order, in our words."),
        /** The page says more steps follow the ones listed, without naming them all. */
        more_after: z.boolean().optional().describe("true when the page says more steps follow the ones listed."),
        /** When each step is due, as the funder dates it, one entry per step (null for an undated step). Never inferred. */
        due: z
          .array(isoDate.nullable())
          .optional()
          .describe('When each step is due (YYYY-MM-DD) in the current or next round, one entry per step, null for an undated step. Only dates one effort quote states with their day and year.'),
      })
      .strict()
      .optional(),
    /** The rules that rule an applicant out, in our words, each phrased as a requirement met (Yes = qualifies, No = ruled out). Missing means not listed. */
    eligibility: z
      .array(
        z.object({
          rule: z.string().min(5).max(120).describe('The rule in our words, phrased as a requirement met: Yes = qualifies, No = ruled out.'),
          kind: eligibilityKind.describe('What the rule is about: legal (status, registration, independence), track_record (years operating, past projects), finances (a financial bar to meet: a revenue range, audited accounts, a request capped by revenue), capacity (staff, systems, policies), project (scope, size, place, partners), other.'),
          min_years: z
            .number()
            .gt(0)
            .max(100)
            .optional()
            .describe('The fewest years the applicant must have been operating, when the rule states it (36 months is 3). Only on a track_record rule; its quote states the number.'),
          revenue: revenueRange.optional().describe('The yearly revenue or budget range the applicant must fall in, when the rule states it. Only on a finances rule; its quote states each number and the currency.'),
          request_cap: requestCap
            .optional()
            .describe('The largest request as a share of the applicant’s yearly revenue or budget, when the rule caps it. Only on a finances rule.'),
        }).strict(),
      )
      .min(1)
      .max(8)
      .optional()
      .describe('The rules that rule an applicant out, in our words, each phrased as a requirement the applicant meets, so Yes means it qualifies and No rules it out. evidence.eligibility holds one quote per rule, in the same order. Missing when the pages we read don’t list them.'),
    /** How much co-funding the funder asks for, when `co_finance_required` is true and the page says. */
    co_finance: z
      .object({
        /** The smallest share of the project the applicant must bring, in percent (a 1:2 match is 33.3). */
        min_share: z.number().gt(0).max(100).optional().describe('The smallest share of the project the applicant must bring, from its own or third-party funds, in percent (a 1:1 match is 50). A match stated as a ratio goes in ratio instead.'),
        /** The match as the funder states a ratio, applicant to funder ("1:2" = one for every two requested). */
        ratio: z
          .string()
          .regex(/^(?!0+(\.0+)?:)\d+(\.\d+)?:(?!0+(\.0+)?$)\d+(\.\d+)?$/)
          .optional()
          .describe('The match as the funder states it as a ratio, applicant to funder: "1:1", "1:2" (one for every two requested).'),
        /** The smallest contribution as a fixed sum, when the funder states one. */
        min_amount: z
          .object({ value: z.number().positive().describe('The sum.'), currency: z.string().regex(/^[A-Z]{3}$/).describe('ISO 4217 code.') })
          .strict()
          .optional()
          .describe('The smallest contribution as a fixed sum in the funder’s currency, when the funder states one.'),
        /** The funder accepts in-kind contributions (staff time, land, equipment) toward it. */
        in_kind: z.literal(true).optional().describe('true when the funder accepts in-kind contributions toward the co-funding.'),
        /** Who or what the requirement applies to, when the funder limits it ("Non-Indigenous applicants only"). */
        applies_to: z.string().min(5).max(80).optional().describe('Who or what the requirement applies to, when the funder limits it, in our words.'),
      })
      .strict()
      .refine((c) => c.min_share === undefined || c.ratio === undefined, 'co_finance takes min_share or ratio, not both')
      .refine((c) => c.min_share !== undefined || c.ratio !== undefined || c.min_amount !== undefined || c.in_kind !== undefined, 'co_finance needs min_share, ratio, min_amount or in_kind')
      .optional(),
    /** What a grantee must do after the award, from the funder's pages. Each key only when stated. */
    after_award: z
      .object({
        /** How often grantees report: one report at the end, yearly, twice a year, or quarterly or more often. */
        reports: z
          .enum(['final', 'interim_and_final', 'yearly', 'twice_yearly', 'quarterly', 'other', 'unspecified'])
          .optional()
          .describe('How often grantees report, by the most frequent required report: final (one at the end), interim_and_final (one or two interim reports and a final), yearly, twice_yearly (every six months), quarterly (quarterly or more often), other (a stated schedule none of these fit, such as at set milestones), unspecified (reports required, how often not stated).'),
        /** An external or independent audit of the grant. */
        audit: z.literal(true).optional().describe('true when the funder requires an external or independent audit.'),
        /** The funder visits the project site. */
        site_visits: z.literal(true).optional().describe('true when the funder says it visits project sites.'),
        /** Grantees must take part in training, a programme or events. */
        training: z.literal(true).optional().describe('true when grantees must take part in training, a capacity programme or events.'),
      })
      .strict()
      .refine((a) => Object.keys(a).length > 0, 'after_award needs at least one stated duty')
      .optional(),
    /** The day the pages were read for eligibility, documents, steps, co-funding and after-award duties. Missing means not read for them yet. */
    requirements_checked: isoDate
      .optional()
      .describe('The day the funder’s pages were read for eligibility, documents, steps, co-funding share and after-award duties. Missing means they haven’t been read for these yet, so an absent fact is unknown, not “none”.'),
    /** What to have ready for the first step, in our words ("Registration certificate"). Missing means not stated. */
    documents: z
      .array(z.string().min(3).max(120))
      .min(1)
      .max(10)
      .optional()
      .describe('The documents the funder asks for at the first step, in our words. Missing when the pages we read don’t say.'),
    /** How many applications the funder says it funded, out of how many, and when. Missing means not published. */
    odds: z
      .object({
        funded: z.number().int().positive().describe("Applications funded."),
        applied: z.number().int().positive().describe("Applications received."),
        /** The round or year the figures are for, as the funder gives it ("2025 round"). */
        period: z.string().min(3).max(60).describe("The round or year the figures are for."),
      })
      .optional(),
    calls: z.array(call).max(20),
    evidence: z.object({
      administered_by: evidence.optional(),
      applicant_types: evidence.optional(),
      geography: evidence.optional(),
      access: evidence.optional(),
      window: evidence.optional(),
      amount: evidence.optional(),
      pool: evidence.optional(),
      co_finance_required: evidence.optional(),
      consortium_required: evidence.optional(),
      reporting: evidence.optional(),
      /** One quote per step at most: a page often names the stages, and their dates, in different places. */
      effort: z.array(evidence).min(1).max(5).optional(),
      /** One quote per rule, in the same order as `eligibility`. */
      eligibility: z.array(evidence).min(1).max(8).optional(),
      co_finance: evidence.optional(),
      /** One quote per duty at most. */
      after_award: z.array(evidence).min(1).max(4).optional(),
      /** A list of documents usually sits in one to three passages; a list spread over a page takes one quote per document at most. */
      documents: z.array(evidence).min(1).max(10).optional(),
      odds: evidence.optional(),
    }).strict(),
    /** The oldest evidence date: every fact above was read on or after this day. */
    checked_at: isoDate,
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })

    const stated: Record<keyof typeof p.evidence, boolean> = {
      administered_by: p.administered_by !== null,
      applicant_types: p.applicant_types !== null,
      geography: p.geography !== null,
      access: p.access !== 'unspecified',
      window: p.window !== 'unspecified',
      amount: p.amount !== null,
      pool: p.pool !== undefined,
      co_finance_required: p.co_finance_required !== null,
      consortium_required: p.consortium_required !== undefined,
      reporting: p.reporting !== null,
      effort: p.effort !== undefined,
      eligibility: p.eligibility !== undefined,
      documents: p.documents !== undefined,
      co_finance: p.co_finance !== undefined,
      after_award: p.after_award !== undefined,
      odds: p.odds !== undefined,
    }
    for (const [field, isStated] of Object.entries(stated)) {
      const e = p.evidence[field as keyof typeof p.evidence]
      if (isStated && !e) issue(['evidence', field], `${field} is stated but has no evidence`)
      if (!isStated && e) issue(['evidence', field], `${field} has evidence but is not stated`)
    }

    if (p.eligibility && p.evidence.eligibility && p.eligibility.length !== p.evidence.eligibility.length) {
      issue(['evidence', 'eligibility'], `each eligibility rule has its own quote: ${p.eligibility.length} rules, ${p.evidence.eligibility.length} quotes`)
    }
    for (const [i, e] of (p.eligibility ?? []).entries()) {
      if (e.min_years !== undefined && e.kind !== 'track_record') issue(['eligibility', i, 'min_years'], 'years operating go on a track_record rule')
      if ((e.revenue || e.request_cap) && e.kind !== 'finances') issue(['eligibility', i, 'kind'], 'a revenue range or request cap goes on a finances rule')
      const quote = p.evidence.eligibility?.[i]?.quote
      if (quote) for (const t of thresholdProblems(e, quote)) issue(['eligibility', i, t.key], t.why)
    }
    if (p.documents && p.evidence.documents && p.evidence.documents.length > Math.max(3, p.documents.length)) {
      issue(['evidence', 'documents'], `more than 3 quotes only at one per document: ${p.documents.length} documents, ${p.evidence.documents.length} quotes`)
    }
    if (p.co_finance && p.co_finance_required !== true) issue(['co_finance'], 'a co-funding share needs co_finance_required: true')
    const due = p.effort?.due
    if (p.effort && due) {
      if (due.length !== p.effort.steps.length) issue(['effort', 'due'], `one due entry per step: ${p.effort.steps.length} steps, ${due.length} entries`)
      if (due.every((d) => d === null)) issue(['effort', 'due'], 'no step is dated; leave due out')
      const quotes = (p.evidence.effort ?? []).map((e) => e.quote)
      const dated = due.filter((d): d is string => d !== null)
      for (const d of dated) if (Number.isNaN(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) issue(['effort', 'due'], `${d} is not a calendar date`)
      // One quote must state the date whole, day, month and year together ("8 January 2027", "Jan. 8, 2027",
      // "08.01.2027", "2027/01/08"). A year from another sentence is not the step's year.
      for (const d of dated) if (!quotes.some((q) => statesDate(q, d))) issue(['effort', 'due'], `no effort quote states ${d} with its day, month and year together; a yearless date stays null`)
      if (dated.some((d, i) => i > 0 && d < dated[i - 1]!)) issue(['effort', 'due'], 'steps are due in order')
    }

    // A round's pot smaller than one grant from that round is a misread. A year's or a programme's pot
    // can be smaller than one multi-year grant, so only rounds are checked.
    const top = p.amount?.max ?? p.amount?.min
    if (p.pool?.period === 'round' && top !== undefined && p.amount?.currency === p.pool.currency && p.amount.per !== 'year' && p.pool.value < top) {
      issue(['pool', 'value'], `the pool (${p.pool.value}) is smaller than one grant (${top})`)
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
      if (c.deadline?.timezone && c.deadline.timezone.length <= 64 && !parseZone(c.deadline.timezone)) {
        issue(at('deadline', 'timezone'), `can't read the timezone "${c.deadline.timezone}"; use an IANA name (Europe/Paris), an offset (UTC+1) or add it to src/lib/deadline.ts`)
      }
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
      ...Object.values(p.evidence).flat(),
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
