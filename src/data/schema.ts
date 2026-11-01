import { z } from 'zod'

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

/** Where a fact was read: the funder's own page, the exact words, and when. */
export const evidence = z.object({
  source_url: z.url(),
  quote: z.string().min(3),
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

/** How an applicant reaches the money. */
export const access = z.enum(['direct', 'intermediary', 'invitation_only', 'unspecified'])

/** How calls recur. */
export const window = z.enum(['fixed', 'rolling', 'unspecified'])

export const callStatus = z.enum(['upcoming', 'open', 'closed', 'suspended', 'unknown'])

const iso2 = z.string().regex(/^[A-Z]{2}$/)

export const deadline = z.object({
  date: isoDate,
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().optional(),
  /** The deadline as the funder wrote it. */
  text: z.string().min(3),
})

export const call = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  url: z.url(),
  status: callStatus,
  opens: isoDate.nullable(),
  deadline: deadline.nullable(),
  evidence: z.object({
    status: evidence,
    opens: evidence.optional(),
    deadline: evidence.optional(),
  }),
})
export type Call = z.infer<typeof call>

export const amount = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  min: z.number().positive().optional(),
  max: z.number().positive().optional(),
})

export const geography = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global') }),
  z.object({
    scope: z.literal('countries'),
    countries: z.array(iso2).min(1),
    /** Plain-language name of a region or hotspot the funder uses, e.g. "Tropical Andes". */
    label: z.string().optional(),
  }),
])

/**
 * One funding programme. Each fact is stated on the funder's page (with its evidence)
 * or left null; null means "not stated", never "no restriction".
 */
export const programme = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    funder: z.object({ name: z.string(), url: z.url() }),
    url: z.url(),
    /** Our own words, one or two sentences. Not copied from the funder. */
    summary: z.string().min(20).max(400),
    approaches: z.array(approach).min(1),
    applicant_types: z.array(applicantType).nullable(),
    geography: geography.nullable(),
    access,
    window,
    amount: amount.nullable(),
    co_finance_required: z.boolean().nullable(),
    /** What the funder asks grantees to report, in our words. */
    reporting: z.string().nullable(),
    calls: z.array(call),
    evidence: z.object({
      applicant_types: evidence.optional(),
      geography: evidence.optional(),
      access: evidence.optional(),
      window: evidence.optional(),
      amount: evidence.optional(),
      co_finance_required: evidence.optional(),
      reporting: evidence.optional(),
    }),
    /** Last time every fact above was read against the funder's pages. */
    checked_at: isoDate,
  })
  .superRefine((p, ctx) => {
    const stated: Record<keyof typeof p.evidence, boolean> = {
      applicant_types: p.applicant_types !== null,
      geography: p.geography !== null,
      access: p.access !== 'unspecified',
      window: p.window !== 'unspecified',
      amount: p.amount !== null,
      co_finance_required: p.co_finance_required !== null,
      reporting: p.reporting !== null,
    }
    for (const [field, isStated] of Object.entries(stated)) {
      if (isStated && !p.evidence[field as keyof typeof p.evidence]) {
        ctx.addIssue({ code: 'custom', path: ['evidence', field], message: `${field} is stated but has no evidence` })
      }
    }
    for (const [i, c] of p.calls.entries()) {
      if (c.deadline && !c.evidence.deadline) {
        ctx.addIssue({ code: 'custom', path: ['calls', i, 'evidence', 'deadline'], message: 'deadline needs evidence' })
      }
      if (c.opens && !c.evidence.opens) {
        ctx.addIssue({ code: 'custom', path: ['calls', i, 'evidence', 'opens'], message: 'opens needs evidence' })
      }
    }
  })
export type Programme = z.infer<typeof programme>
