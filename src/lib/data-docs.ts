import { z } from 'zod'
import { programme } from '../data/schema'
import { absolute } from './site'

/**
 * What each field of /data.json means. The /data/ page prints these, and /data.schema.json carries them as
 * descriptions, so the docs and the schema can't disagree. tests/agent.test.ts fails when a schema field has none.
 */
export const fieldDocs = {
  programme: {
    id: 'Stable identifier and URL slug: the listing is /p/{id}/. Facts change; the id does not.',
    name: 'The programme’s name, as the funder writes it.',
    funder: 'The organisation that provides the money.',
    administered_by: 'The organisation that runs the call for the funder (for example a UNDP country office), or null.',
    parent: 'The id of the umbrella programme this one belongs to (a country programme’s global programme), or null.',
    url: 'The funder’s main page for the programme.',
    summary: 'One or two sentences in naturefunding.org’s own words. Not a quote.',
    kind: '“partnership” for paid work under contract (planting partners), which is not a grant. Missing means grant.',
    approaches: 'naturefunding.org’s classification of the work it supports, from the funder’s description.',
    applicant_types: 'Who can apply, in our categories from the funder’s words (the quote is in evidence), or null when the pages we read don’t say.',
    geography: 'Where projects can be, in our categories from the funder’s words (the quote is in evidence), or null when the pages we read don’t say.',
    access: 'How an applicant reaches the money: direct (apply to an open call), intermediary (apply to a partner, not the funder), invitation_only (no unsolicited proposals), unspecified.',
    window: 'fixed (rounds with deadlines), rolling (apply any time) or unspecified.',
    amount: 'Grant size in the funder’s currency, or null when not stated.',
    co_finance_required: 'true or false when the funder says whether co-funding is required; null when it doesn’t.',
    reporting: 'What the funder asks grantees to report, in our words, or null.',
    calls: 'The rounds of applications we found. Intermediary and invitation-only programmes list none.',
    evidence: 'For each stated programme-level fact, where it was read: the field name maps to an evidence object.',
    checked_at: 'The oldest evidence date: every fact in this programme was read on or after this day (YYYY-MM-DD).',
  },
  organisation: {
    name: 'The organisation’s name.',
    url: 'The organisation’s website.',
  },
  call: {
    id: 'Identifier of the call, unique within its programme.',
    label: 'The call’s name, as the funder writes it.',
    url: 'The funder’s page for this call.',
    status: 'upcoming, open, closed, suspended or unknown, as of evidence.status.checked_at. A call closed because its stated deadline passed carries its deadline evidence there instead.',
    opens: 'The date the call opens (YYYY-MM-DD), only when the funder states a firm date with its year; else null.',
    deadline: 'The deadline, only when the funder states it with its year; else null. Never inferred.',
    evidence: 'Where status, opens, deadline and recurring were read.',
    expected: 'When the funder expects an upcoming call to open, in its own words (“June 2027”). Firm dates go in opens.',
    recurring: 'Dates the funder gives without a year, repeating each year, in our words.',
    note: 'A condition the funder puts on the call, in our words (“Subject to funding approval”).',
  },
  deadline: {
    date: 'The deadline day (YYYY-MM-DD).',
    time: 'The cutoff time (HH:MM), when the funder states one.',
    timezone: 'The time zone of the cutoff time, when the funder states one: an IANA name where we could map it, otherwise the funder’s abbreviation or offset (“CEST”, “EDT (UTC-4)”).',
    text: 'The deadline as the funder wrote it.',
  },
  amount: {
    currency: 'ISO 4217 currency code.',
    min: 'The smallest grant, when stated.',
    max: 'The largest grant, when stated.',
    typical: 'true when the funder gives a usual range (“typically”), not hard limits.',
    max_exclusive: 'true when the funder says “less than” the max, not “up to”.',
    per: '“year” when the amount is per year, not per grant.',
    note: 'A qualifier from the same quote, in our words.',
  },
  geography: {
    scope: 'global (anywhere), countries (a list) or regions (a group the funder names, such as “ODA-eligible countries”).',
    countries: 'ISO 3166-1 alpha-2 country codes.',
    regions: 'Broad regions the group covers.',
    label: 'The funder’s own name for the area or group.',
  },
  evidence: {
    source_url: 'The page the fact was read from: the funder’s, or the organisation running the programme.',
    quote: 'The exact words on that page that state the fact. The funder’s words, not covered by our licence.',
    checked_at: 'The last day we read that page and found these words (YYYY-MM-DD).',
    method: 'How it was read: page (read from the web page), api (a funder’s API) or human (a person re-read the page by hand).',
  },
} as const

export const fileDocs = {
  name: 'Title of the dataset.',
  url: 'The site.',
  license: 'SPDX licence of the data. Quotes are the funders’ words and are not covered.',
  attribution: 'How to credit the data.',
  source: 'The repository the data is built from.',
  generated_on: 'The day this file was built (YYYY-MM-DD). Statuses are as of the evidence dates, not this day.',
  note: 'How to read the evidence.',
  programmes: 'Every programme, including ones hidden from the finder after 90 days without a check.',
} as const

type Json = { [k: string]: unknown }

/** Which docs an object schema takes, by the properties it has. */
const docsFor = (props: string[]): Record<string, string> | null => {
  const has = (...ks: string[]) => ks.every((k) => props.includes(k))
  if (has('summary', 'calls', 'evidence')) return fieldDocs.programme
  if (has('label', 'status', 'deadline')) return fieldDocs.call
  if (has('date', 'text')) return fieldDocs.deadline
  if (has('currency')) return fieldDocs.amount
  if (has('scope')) return fieldDocs.geography
  if (has('source_url', 'quote', 'checked_at')) return fieldDocs.evidence
  if (props.length === 2 && has('name', 'url')) return fieldDocs.organisation
  return null
}

/** Adds the descriptions to every object schema in the tree, in place. */
function describe(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(describe)
  if (!node || typeof node !== 'object') return
  const o = node as Json
  const props = o.properties as Record<string, Json> | undefined
  if (props) {
    const docs = docsFor(Object.keys(props))
    for (const [k, v] of Object.entries(props)) if (docs?.[k] && !v.description) v.description = docs[k]
    // An evidence map: each key is the field it backs.
    const ev = props.evidence?.properties as Record<string, Json> | undefined
    for (const [k, v] of Object.entries(ev ?? {})) if (!v.description) v.description = `Where ${k} was read, when it is stated.`
  }
  for (const v of Object.values(o)) describe(v)
}

export const SCHEMA_URL = absolute('/data.schema.json')

/** JSON Schema of /data.json, from the same zod schema `bun run validate` uses. Refinements (cross-field rules) are not expressible here; the zod schema is the full contract. */
export function dataJsonSchema() {
  const item = z.toJSONSchema(programme, { io: 'output', unrepresentable: 'any' }) as Json
  delete item.$schema
  describe(item)
  const str = { type: 'string' }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_URL,
    title: 'naturefunding.org data.json',
    description: `Grants and funding for nature restoration and conservation, with evidence for every stated fact. Field guide: ${absolute('/data/')}`,
    type: 'object',
    required: ['name', 'url', 'license', 'generated_on', 'programmes'],
    properties: {
      $schema: { type: 'string', format: 'uri', description: 'This schema’s URL.' },
      name: { ...str, description: fileDocs.name },
      url: { ...str, format: 'uri', description: fileDocs.url },
      license: { ...str, description: fileDocs.license },
      attribution: { ...str, description: fileDocs.attribution },
      source: { ...str, format: 'uri', description: fileDocs.source },
      generated_on: { ...str, pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: fileDocs.generated_on },
      note: { ...str, description: fileDocs.note },
      programmes: { type: 'array', description: fileDocs.programmes, items: item },
    },
  }
}
