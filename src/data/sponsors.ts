import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { geographyIssues } from './geography'
import { evidence, geography, isoDate, iso2, slug, type Evidence } from './schema'

/**
 * Fiscal sponsors: charities and nonprofits that receive or manage funding for other people's projects.
 * Every value sits next to the sponsor's own words for it, so no fact can be listed without its evidence, and a fact
 * the sponsor doesn't publish is left out, never inferred (a "Model A" label alone says nothing about staff or grants).
 *
 * Listed when the sponsor's own pages 1) offer sponsorship to projects it doesn't already run and 2) name nature,
 * conservation, climate or the environment among the work it takes, or open hardware, open source software or open research,
 * which field tools and monitoring need. The page groups them by `types`.
 */
/**
 * The kinds of project a sponsor says it takes. Its own programmes, menus and the groups it already hosts prove nothing.
 * The last two are for a sponsor that names no single subject: `environment` for environmental work in general, `any` for
 * charitable or social work in general. Its mission still limits what it takes; `projects` says how.
 */
export const sponsorTypes = ['wildlife', 'conservation', 'ocean', 'research', 'hardware', 'software', 'media', 'community', 'environment', 'any'] as const
export type SponsorType = (typeof sponsorTypes)[number]

const text = (max: number) => z.string().min(3).max(max)
const fact = <T extends z.ZodType>(value: T) => z.object({ value, evidence }).strict()
/** A published figure: every number in our words has to be in the sponsor's. */
const figure = (max: number) => fact(text(max)).refine((f) => numbers(f.value).every((n) => numbers(f.evidence.quote).includes(n)), 'a number in the value is not in its quote')

const numbers = (s: string) => [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''))

/**
 * What a quote has to say to back a claim, because one sentence is easily stretched over a neighbouring one: working
 * abroad isn't being based abroad, citizenship isn't a base, "organisation" isn't "company", and grants that come through
 * a sponsor don't say who signs or is paid.
 */
const says = {
  companies: /compan(y|ies)|corporat|(?<!not-)\bfor-profit|\bLLCs?\b|incorporated|legal entit/i,
  foreign: /\b(based|registered|incorporated)\b|\bBe located within|U\.?S\.? base of operations|from anywhere|\b(international|foreign|overseas|[A-Z][a-z]+n) (charit|non-?profit|organi[sz]ation|group|NGO)/,
  grants: {
    applicant: /applicant/i,
    project_applies: /your project applies|submits the (grant )?application/i,
    receives: /receiv|awarded grant funding by|grants\/donations go/i,
    signs: /\bsign|executed by/i,
    through: /grants?\b|\bincome\b/i,
    donations: /donation/i,
  },
}
/** Words that put a project anywhere: a sponsor's `places` is `global` only on these. */
const anywhere = /anywhere|worldwide|globally|all around the world|international (initiatives|charities|NGOs)/i
/** A tax status alone doesn't say where a sponsor is. */
const onlyTaxStatus = (quote: string) => /501 ?\(?c\)/.test(quote) && !/\bU\.?S\b|USA|United States|\b(based|registered|incorporated) in\b/.test(quote)
/** Words in a quote that limit a figure or a step, and what our value must keep of them. */
const limits: [RegExp, RegExp, string][] = [
  [/\b(typically|usually|generally)\b/i, /typically|usually|generally/i, 'typically'],
  [/\bmay (apply|be (negotiable|higher))|\bmight apply/i, /\bmay\b|\bmore for\b/i, 'may'],
  [/case-by-case/i, /case by case/i, 'case by case'],
  [/\bprovided (that )?you/i, /provided|\bif\b/i, 'the condition after “provided”'],
  [/\bnew (members|\w+ members)/i, /\bnew\b/i, 'new members'],
  [/\bif (we|our|invited)\b|upon successful|if a board member/i, /\b(if|once|invit\w+)\b/i, 'the condition on the step'],
  [/\bmay (agree|be submitted)/i, /\bmay\b/i, 'may'],
]

const answer = fact(
  z
    .object({
      answer: z.enum(['yes', 'no', 'case_by_case']),
      /** The condition on the answer, in our words. */
      note: text(200).optional(),
    })
    .strict(),
)

export const sponsor = z
  .object({
    id: slug,
    name: z.string().min(1).max(200),
    /** The sponsor's own page about its sponsorship. */
    url: z.url().max(500),
    /** Our own words, one or two sentences. */
    summary: z.string().min(20).max(300),
    /** Where the sponsor itself is: its registration, base or address, never its tax status alone. */
    country: fact(iso2),
    legal_form: fact(text(120)).optional(),
    /** What it takes, from its own words: the theme, and any limit on the kind of project. */
    projects: fact(text(240)),
    /** Each kind of project it takes, with the words that say so. */
    types: z.array(fact(z.enum(sponsorTypes))).min(1).max(sponsorTypes.length),
    /** The rule most likely to stop a project, shown before anything else. Not repeated in `conditions`. */
    gate: fact(text(160)).optional(),
    /** Where projects or groups can be. */
    where: fact(text(160)).optional(),
    /**
     * The same place as a grant's `geography`, matched by the page's Where filter (src/lib/where-codes.ts). Only when a
     * quote names where a project or its group can be: who it pays or what a form asks is not a place a project may be.
     */
    places: fact(geography).optional(),
    /** Who it takes. `foreign` is a group or person outside the sponsor's own country. */
    individuals: answer.optional(),
    companies: answer.optional(),
    foreign: answer.optional(),
    /**
     * inside: the project becomes part of the sponsor. grant_to_entity: the sponsor passes the money on to a separate
     * person or organisation.
     */
    models: z.array(fact(z.enum(['inside', 'grant_to_entity']))).min(1).max(2).optional(),
    /** Every charge it publishes: percentages, tiers, surcharges, application and filing fees. */
    fees: z.array(figure(160)).min(1).max(8).optional(),
    /** What it says to a group or person that already has its own legal organisation, when that doesn't answer for companies. */
    own_entity: fact(text(120)).optional(),
    /** The smallest income, budget or project size it asks for, or that it asks for none. Not the size of one donation. */
    min_income: figure(200).optional(),
    /**
     * What its pages say about grants: applicant (it is named as the applicant), project_applies (the project applies; the
     * sponsor signs or is paid). Then, with the applicant not said: receives (the grant is paid to it), signs (it signs the
     * agreement), through (grants come through it, and no more is said), donations (only donations are described).
     */
    grants: fact(z.object({ role: z.enum(['applicant', 'project_applies', 'receives', 'signs', 'through', 'donations']), note: text(160) }).strict()).optional(),
    /** Whether the project's people can be paid, and how. */
    staff: answer.optional(),
    /** Whether it is taking projects now. Missing when its pages don't say. */
    intake: fact(z.object({ status: z.enum(['open', 'between_rounds', 'paused']), note: text(160) }).strict()).optional(),
    /** Rules that stop a project, in our words. */
    conditions: z.array(fact(text(160))).min(1).max(8).optional(),
    /** How to apply, step by step, in our words. */
    steps: z.array(fact(text(200))).min(1).max(7).optional(),
    /** What the form or first contact asks for. */
    form_asks: z.array(fact(text(200))).min(1).max(8).optional(),
    /** The same organisation's listing on this site, when it has one. */
    programme_id: slug.optional(),
    /** The oldest evidence date. */
    checked_at: isoDate,
  })
  .strict()
  .superRefine((s, ctx) => {
    const oldest = sponsorEvidence(s).map((e) => e.checked_at).sort()[0]
    if (s.checked_at !== oldest) ctx.addIssue({ code: 'custom', path: ['checked_at'], message: `must be the oldest evidence date, ${oldest}` })
    const once = (path: 'models' | 'types') => {
      const values = (s[path] ?? []).map((f) => f.value)
      if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path: [path], message: 'the same value twice' })
    }
    const quote = (path: string, ok: boolean, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message })
    }
    quote('country', !onlyTaxStatus(s.country.evidence.quote), 'its quote gives a tax status, not where the sponsor is')
    if (s.places?.value.scope === 'global') quote('places', anywhere.test(s.places.evidence.quote), 'its quote doesn’t say projects can be anywhere')
    if (s.companies) quote('companies', says.companies.test(s.companies.evidence.quote), 'its quote doesn’t speak of companies')
    if (s.foreign) quote('foreign', says.foreign.test(s.foreign.evidence.quote), 'its quote doesn’t say where the group itself is based')
    if (s.grants) quote('grants', says.grants[s.grants.value.role].test(s.grants.evidence.quote), `its quote doesn’t say ${s.grants.value.role}`)
    for (const field of ['fees', 'steps', 'min_income'] as const)
      for (const f of [s[field] ?? []].flat())
        for (const [inQuote, kept, what] of limits)
          if (inQuote.test(f.evidence.quote)) quote(field, kept.test(f.value), `“${f.value}” drops “${what}”, which its quote says`)
    once('models')
    once('types')
  })
export type Sponsor = z.infer<typeof sponsor>

const isFact = (v: unknown): v is { evidence: Evidence } => typeof v === 'object' && v !== null && 'evidence' in v

/** Every fact a sponsor's file holds, with a readable path, e.g. `country` or `fees[1]`. */
export const sponsorFacts = (s: object): { path: string; evidence: Evidence }[] =>
  Object.entries(s).flatMap(([field, v]) =>
    [v].flat().flatMap((f, i) => (isFact(f) ? [{ path: Array.isArray(v) ? `${field}[${i}]` : field, evidence: f.evidence }] : [])),
  )

/** Every quote a sponsor's file holds. */
export const sponsorEvidence = (s: object): Evidence[] => sponsorFacts(s).map((f) => f.evidence)

/** Reads and checks every sponsor file. `programmes` are the ids a `programme_id` may point to. */
export function checkSponsors(dir: string, programmes: Set<string>): { sponsors: Sponsor[]; issues: string[] } {
  const sponsors: Sponsor[] = []
  const issues: string[] = []
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []) {
    const where = `sponsors/${file}`
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (e) {
      issues.push(`${where}: invalid JSON: ${(e as Error).message}`)
      continue
    }
    const parsed = sponsor.safeParse(raw)
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((i) => `${where}: ${i.path.join('.') || '(root)'}: ${i.message}`))
      continue
    }
    const s = parsed.data
    if (s.id !== basename(file, '.json')) issues.push(`${where}: id ${s.id} must match the file name`)
    if (s.places) issues.push(...geographyIssues({ geography: s.places.value, evidence: { geography: s.places.evidence } } as Parameters<typeof geographyIssues>[0]).map((i) => `${where}: places: ${i}`))
    if (s.programme_id && !programmes.has(s.programme_id)) issues.push(`${where}: programme ${s.programme_id} does not exist`)
    sponsors.push(s)
  }
  return { sponsors: sponsors.sort((a, b) => a.name.localeCompare(b.name, 'en')), issues }
}
