import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { evidence, isoDate, iso2, slug, type Evidence } from './schema'

/**
 * Fiscal sponsors: charities and nonprofits that take other people's nature projects under their own legal status.
 * Every value sits next to the sponsor's own words for it, so no fact can be listed without its evidence, and a fact
 * the sponsor doesn't publish is left out, never inferred (a "Model A" label alone says nothing about staff or grants).
 *
 * Listed when the sponsor's own pages 1) offer sponsorship to projects it doesn't already run and 2) name nature,
 * conservation, climate or the environment among the work it takes, or open hardware for science, which field tools need.
 * `scope` labels the ones a field project may not fit.
 */
const text = (max: number) => z.string().min(3).max(max)
const fact = <T extends z.ZodType>(value: T) => z.object({ value, evidence }).strict()
/** A published figure: every number in our words has to be in the sponsor's. */
const figure = (max: number) => fact(text(max)).refine((f) => numbers(f.value).every((n) => numbers(f.evidence.quote).includes(n)), 'a number in the value is not in its quote')

const numbers = (s: string) => [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''))

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
    /**
     * Our classification of what it takes: nature (nature or the environment is its subject), general (any public-benefit
     * work, nature included), open_hardware (open hardware for science only), media (films, photos and stories only).
     */
    scope: z.enum(['nature', 'general', 'open_hardware', 'media']),
    /** Where the sponsor itself is registered. */
    country: fact(iso2),
    legal_form: fact(text(120)).optional(),
    /** What it takes, from its own words: the theme, and any limit on the kind of project. */
    projects: fact(text(240)),
    /** Where projects or groups can be. */
    where: fact(text(160)).optional(),
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
    /** The smallest income, budget or project size it asks for, or that it asks for none. */
    min_income: figure(200).optional(),
    /**
     * What its pages say about grants: applicant (it applies or is named as the applicant), receives (it signs the grant
     * agreement, or the grant is paid to it; who applies isn't said), donations (only donations are described).
     */
    grants: fact(z.object({ role: z.enum(['applicant', 'receives', 'donations']), note: text(240) }).strict()).optional(),
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
    const models = s.models?.map((m) => m.value) ?? []
    if (new Set(models).size !== models.length) ctx.addIssue({ code: 'custom', path: ['models'], message: 'the same model twice' })
  })
export type Sponsor = z.infer<typeof sponsor>

const isFact = (v: unknown): v is { evidence: Evidence } => typeof v === 'object' && v !== null && 'evidence' in v

/** Every quote a sponsor's file holds. */
export const sponsorEvidence = (s: object): Evidence[] =>
  Object.values(s)
    .flat()
    .filter(isFact)
    .map((f) => f.evidence)

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
    if (s.programme_id && !programmes.has(s.programme_id)) issues.push(`${where}: programme ${s.programme_id} does not exist`)
    sponsors.push(s)
  }
  return { sponsors: sponsors.sort((a, b) => a.name.localeCompare(b.name, 'en')), issues }
}
