/**
 * Stage 3, extract: a cheap model reads every gathered word, never a pre-filtered excerpt. When all the
 * text fits one prompt it reads it whole; otherwise it reads every chunk (split on headings, with overlap
 * and the document named) and the answers are reconciled. Each field comes back as items with verbatim
 * quotes or as not_found. The answer shape is loose on purpose; verify.ts holds it to the schema.
 */
import { z } from 'zod'
import type { Programme } from '../../src/data/schema'
import { applicantType, eligibilityKind } from '../../src/data/schema'
import { comparable } from '../../src/data/text'
import { sameItem } from './verify'
import type { Doc } from './gather'
import type { Ask } from './models'

export const PROMPT_VERSION = 'req-2026-11-16.1'

/** One prompt holds this much page text; above it, chunks. About 50K tokens, under the long-prompt price step (Haiku 100K, GPT-5.6 272K). */
export const WHOLE_CHARS = 180_000
export const CHUNK_CHARS = 40_000
const OVERLAP = 1_500

export const FIELDS = ['eligibility', 'documents', 'effort', 'co_finance', 'consortium', 'after_award'] as const
export type Field = (typeof FIELDS)[number]

const status = z.enum(['stated', 'not_found'])
const ref = { doc: z.string().describe('The document the quote is from: D1, D2…'), quote: z.string().describe('Words copied exactly from that document, 5 to 50 words, in its language. No ellipsis, no paraphrase.') }

export const wire = z.object({
  eligibility: z.object({
    status,
    items: z.array(
      z.object({
        rule: z.string(),
        kind: eligibilityKind,
        ...ref,
        min_years: z.number().nullable(),
        revenue: z
          .object({ currency: z.string(), min: z.number().nullable(), max: z.number().nullable(), basis: z.enum(['revenue', 'budget', 'expenditure']), average_years: z.number().nullable() })
          .nullable(),
        request_cap: z.object({ share: z.number(), of: z.enum(['revenue', 'budget']) }).nullable(),
      }),
    ),
  }),
  documents: z.object({ status, items: z.array(z.object({ item: z.string(), ...ref })) }),
  effort: z.object({
    status,
    steps: z.array(z.object({ step: z.string(), due: z.string().nullable(), ...ref })),
    more_after: z.boolean(),
  }),
  co_finance: z.object({
    status,
    required: z.boolean().nullable(),
    doc: z.string().nullable(),
    quote: z.string().nullable(),
    min_share: z.number().nullable(),
    ratio: z.string().nullable(),
    min_amount: z.object({ value: z.number(), currency: z.string() }).nullable(),
    in_kind: z.boolean().nullable(),
    applies_to: z.string().nullable(),
    detail_doc: z.string().nullable(),
    detail_quote: z.string().nullable(),
  }),
  consortium: z.object({ status, required: z.boolean().nullable(), doc: z.string().nullable(), quote: z.string().nullable() }),
  after_award: z.object({
    status,
    items: z.array(
      z.object({
        duty: z.enum(['reports', 'audit', 'site_visits', 'training']),
        reports: z.enum(['final', 'interim_and_final', 'yearly', 'twice_yearly', 'quarterly', 'other', 'unspecified']).nullable(),
        ...ref,
      }),
    ),
  }),
  notes: z.string(),
})
export type Wire = z.infer<typeof wire>

/**
 * What the model is asked for. Structured outputs allow at most 16 union (nullable) parameters, so the
 * model writes "" for no text, 0 for no number and "not_stated" for no answer; fromApi turns those into nulls.
 */
const s0 = z.string().describe('Empty string when not stated.')
const n0 = (d: string) => z.number().describe(`${d} 0 when not stated.`)
const apiRef = { doc: ref.doc, quote: ref.quote }
const statedEnum = z.enum(['yes', 'no', 'not_stated'])
export const apiWire = z.object({
  eligibility: z.object({
    status,
    items: z.array(
      z.object({
        rule: z.string(),
        kind: eligibilityKind,
        ...apiRef,
        min_years: n0('Fewest years operating.'),
        revenue: z
          .object({ currency: z.string(), min: n0('Smallest yearly amount.'), max: n0('Largest yearly amount.'), basis: z.enum(['revenue', 'budget', 'expenditure']), average_years: n0('Years averaged over.') })
          .nullable(),
        request_cap: z.object({ share: z.number(), of: z.enum(['revenue', 'budget']) }).nullable(),
      }),
    ),
  }),
  documents: z.object({ status, items: z.array(z.object({ item: z.string(), ...apiRef })) }),
  effort: z.object({ status, steps: z.array(z.object({ step: z.string(), due: s0, ...apiRef })), more_after: z.boolean() }),
  co_finance: z.object({
    status,
    required: statedEnum,
    doc: s0,
    quote: s0,
    min_share: n0('Percent.'),
    ratio: s0,
    min_amount: z.object({ value: z.number(), currency: z.string() }).nullable(),
    in_kind: z.boolean(),
    applies_to: s0,
    detail_doc: s0,
    detail_quote: s0,
  }),
  consortium: z.object({ status, required: statedEnum, doc: s0, quote: s0 }),
  after_award: z.object({
    status,
    items: z.array(z.object({ duty: z.enum(['reports', 'audit', 'site_visits', 'training']), reports: z.enum(['final', 'interim_and_final', 'yearly', 'twice_yearly', 'quarterly', 'other', 'unspecified', 'none']), ...apiRef })),
  }),
  notes: z.string(),
  missing_documents: z.array(z.string()).describe('Documents the text says hold rules applicants must meet (guidelines, call text, a handbook) that you were not given, by name or link. Empty when none.'),
})
export type ApiWire = z.infer<typeof apiWire>

const orNull = <T,>(v: T, empty: T): T | null => (v === empty ? null : v)
const yn = (v: 'yes' | 'no' | 'not_stated') => (v === 'not_stated' ? null : v === 'yes')
export function fromApi(a: ApiWire): Wire & { missing_documents: string[] } {
  return {
    eligibility: {
      status: a.eligibility.status,
      items: a.eligibility.items.map((e) => ({
        ...e,
        min_years: orNull(e.min_years, 0),
        revenue: e.revenue && { ...e.revenue, min: orNull(e.revenue.min, 0), max: orNull(e.revenue.max, 0), average_years: orNull(e.revenue.average_years, 0) },
      })),
    },
    documents: a.documents,
    effort: { ...a.effort, steps: a.effort.steps.map((s) => ({ ...s, due: orNull(s.due.trim(), '') })) },
    co_finance: {
      ...a.co_finance,
      required: yn(a.co_finance.required),
      doc: orNull(a.co_finance.doc, ''),
      quote: orNull(a.co_finance.quote, ''),
      min_share: orNull(a.co_finance.min_share, 0),
      ratio: orNull(a.co_finance.ratio, ''),
      in_kind: a.co_finance.in_kind || null,
      applies_to: orNull(a.co_finance.applies_to, ''),
      detail_doc: orNull(a.co_finance.detail_doc, ''),
      detail_quote: orNull(a.co_finance.detail_quote, ''),
    },
    consortium: { ...a.consortium, required: yn(a.consortium.required), doc: orNull(a.consortium.doc, ''), quote: orNull(a.consortium.quote, '') },
    after_award: { ...a.after_award, items: a.after_award.items.map((i) => ({ ...i, reports: i.duty === 'reports' ? (i.reports === 'none' ? 'unspecified' : i.reports) : null })) },
    notes: a.notes,
    missing_documents: a.missing_documents,
  }
}

/** The other way, for tests and fakes. */
export function toApi(w: Wire, missing: string[] = []): ApiWire {
  const z0 = <T,>(v: T | null, empty: T) => (v === null ? empty : v)
  const ny = (v: boolean | null) => (v === null ? 'not_stated' : v ? 'yes' : 'no') as 'yes' | 'no' | 'not_stated'
  return {
    eligibility: {
      status: w.eligibility.status,
      items: w.eligibility.items.map((e) => ({
        ...e,
        min_years: z0(e.min_years, 0),
        revenue: e.revenue && { ...e.revenue, min: z0(e.revenue.min, 0), max: z0(e.revenue.max, 0), average_years: z0(e.revenue.average_years, 0) },
      })),
    },
    documents: w.documents,
    effort: { ...w.effort, steps: w.effort.steps.map((s) => ({ ...s, due: s.due ?? '' })) },
    co_finance: {
      ...w.co_finance,
      required: ny(w.co_finance.required),
      doc: w.co_finance.doc ?? '',
      quote: w.co_finance.quote ?? '',
      min_share: w.co_finance.min_share ?? 0,
      ratio: w.co_finance.ratio ?? '',
      in_kind: w.co_finance.in_kind ?? false,
      applies_to: w.co_finance.applies_to ?? '',
      detail_doc: w.co_finance.detail_doc ?? '',
      detail_quote: w.co_finance.detail_quote ?? '',
    },
    consortium: { ...w.consortium, required: ny(w.consortium.required), doc: w.consortium.doc ?? '', quote: w.consortium.quote ?? '' },
    after_award: { ...w.after_award, items: w.after_award.items.map((i) => ({ ...i, reports: i.reports ?? 'none' })) },
    notes: w.notes,
    missing_documents: missing,
  }
}

export const SYSTEM = `You read a funder's pages and documents about one grant programme and report what an applicant must meet, submit and do, as JSON. The facts go on naturefunding.org, a neutral list of nature grants for organisations running restoration or conservation projects.

Rules for every field:
- Only what the text states. Never guess or infer. If the text doesn't state a field, give status "not_found" and no items.
- Every item has "doc" (D1, D2…) and "quote": words copied exactly from that document, 5 to 50 words, in the document's language, that state the item. Copy characters as they appear; no ellipsis, no paraphrase, no translation. Quotes must not span two documents.
- Our own words (rule, item, step, applies_to) are short plain English, whatever the page's language.
- Read for the current or next round. If the text gives different rules for an older round, use the current ones.

eligibility: the rules that rule an applicant out. Each "rule" (5 to 120 characters) is phrased as a requirement the applicant meets, so Yes means it qualifies and No rules it out ("Operating for at least 3 years by the deadline", "Not a government body"; never "Registered as a government body"). Hard requirements only: not selection or scoring criteria, priorities, preferences or what makes a strong application. One rule per requirement the funder states separately; keep a requirement stated in one sentence as one rule. At most 8, most decisive first. Include a place or organisation-type rule only when it is stricter than a plain list of countries or of applicant types (${applicantType.options.join(', ')}). A required consortium goes in "consortium", not here. kind: legal (status, registration, independence, not a government body), track_record (years operating, past projects), finances (a financial bar: a revenue or turnover range, audited accounts, a request capped by revenue), capacity (staff, systems, policies), project (the project's scope, size, place or partners), other.
Typed values on a rule, only when its quote states them, else 0 or null as the schema says: min_years (fewest years operating; 36 months is 3) on a track_record rule; revenue {currency ISO 4217, min, max, basis: revenue|budget|expenditure, average_years when averaged over several years} on a finances rule; request_cap {share: the largest request in percent of yearly revenue or budget, 100 = one year's revenue; of: revenue|budget} on a finances rule.

documents: what applicants submit at the first step, one item per type of document, 3 to 120 characters ("Registration certificate", "Audited accounts for the last 2 years"). Not the application form itself. At most 10.

effort: the stages an applicant submits or is reviewed at, in order, at most 5, each "step" 3 to 80 characters ("Concept note", "Full proposal, if invited", "Interview"). Creating an account, filling the form and pressing submit are one step. "due": the date that step is due in the current or next round as YYYY-MM-DD, only when the quote states its day, month and year together; otherwise "". more_after: true when the text says further steps follow the ones listed.

co_finance: required "yes" when applicants must bring matching funds or co-funding, "no" when the text says none is needed, "not_stated" otherwise; "quote" states it. When required and the text says how much: min_share (smallest share of the project the applicant brings, in percent; a 1:1 match is 50), or ratio ("1:2" applicant to funder) when stated as a ratio, never both; min_amount {value, currency} for a fixed sum; in_kind true when staff time, land or equipment count; applies_to (5 to 80 characters) when it covers only some applicants. detail_quote states the amount, if a different sentence.

consortium: required "yes" when applicants must apply as a consortium of several organisations, "no" when the text says single applicants are fine or consortia are not allowed, "not_stated" otherwise.

after_award: what a grantee must do after the award, one item per duty stated: reports (with "reports": final = one report at the end, interim_and_final = one or two interim reports and a final, yearly, twice_yearly, quarterly = quarterly or more often, other = a stated schedule none of these fit, unspecified = reports required, how often not stated), audit (an external or independent audit of the grant), site_visits (the funder visits project sites), training (required training, a capacity programme or events).

For a field you can't fill, write "" for text, 0 for numbers and false for in_kind. On a duty other than reports, reports is "none".

missing_documents: documents the text says hold rules applicants must meet (guidelines, call text, a handbook, terms) that are not among the documents you were given, by name or link. Empty when none.

notes: anything a reviewer should know, such as rules that differ by round. Empty string if nothing.`

export type Chunk = { id: string; docs: string[]; text: string }

const header = (d: Doc) => `=== ${d.ref}: ${d.url}${d.pdf ? ' (PDF)' : ''}${d.from ? ` linked from ${d.from}` : ''} ===`

/** Text split on headings and paragraph breaks into pieces under `max` characters, each overlapping the one before. */
export function splitText(text: string, max = CHUNK_CHARS, overlap = OVERLAP): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let at = 0
  while (at < text.length) {
    let end = Math.min(text.length, at + max)
    if (end < text.length) {
      // Prefer to cut before a heading-like line or a sentence end in the last fifth of the piece.
      const window = text.slice(at + Math.floor(max * 0.8), end)
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '))
      if (cut > 0) end = at + Math.floor(max * 0.8) + cut + 1
    }
    out.push(text.slice(at, end))
    if (end >= text.length) break
    at = end - overlap
  }
  return out
}

/** Every gathered document as prompt text: one piece when it all fits, otherwise chunks that name their document. */
export function chunksOf(docs: Doc[], whole = WHOLE_CHARS, max = CHUNK_CHARS): Chunk[] {
  const readable = docs.filter((d) => d.text.length)
  const total = readable.reduce((a, d) => a + d.text.length + 200, 0)
  if (total <= whole) return [{ id: 'all', docs: readable.map((d) => d.ref), text: readable.map((d) => `${header(d)}\n${d.text}`).join('\n\n') }]
  const out: Chunk[] = []
  let pack: Doc[] = []
  let size = 0
  const flush = () => {
    if (pack.length) out.push({ id: `c${out.length + 1}`, docs: pack.map((d) => d.ref), text: pack.map((d) => `${header(d)}\n${d.text}`).join('\n\n') })
    pack = []
    size = 0
  }
  for (const d of readable) {
    if (d.text.length + 200 > max) {
      flush()
      const parts = splitText(d.text, max)
      parts.forEach((t, i) => out.push({ id: `c${out.length + 1}`, docs: [d.ref], text: `${header(d)} part ${i + 1} of ${parts.length}\n${t}` }))
      continue
    }
    if (size + d.text.length + 200 > max) flush()
    pack.push(d)
    size += d.text.length + 200
  }
  flush()
  return out
}

export function userPrompt(p: Programme, chunk: Chunk, total: number, focus?: Field[]) {
  const rounds = p.calls.map((c) => `${c.label} (${c.status}${c.deadline ? `, deadline ${c.deadline.date}` : ''})`).join('; ') || 'none listed'
  return [
    `Programme: ${p.name}`,
    `Funder: ${p.funder.name}${p.administered_by ? `, run by ${p.administered_by.name}` : ''}`,
    `Rounds we list: ${rounds}`,
    `Who may apply, as we list it: ${p.applicant_types?.join(', ') ?? 'not stated'}. Where: ${p.geography ? JSON.stringify(p.geography) : 'not stated'}.`,
    total > 1 ? `This is part ${chunk.id} of ${total}: report what this part states; other parts are read separately.` : 'This is all the text we gathered.',
    focus ? `Report only these fields carefully: ${focus.join(', ')}. Give the others status "not_found".` : '',
    '',
    chunk.text,
  ].filter((l) => l !== '').join('\n')
}

const sameText = (a: string, b: string) => {
  const x = comparable(a)
  const y = comparable(b)
  return x === y || x.includes(y) || y.includes(x)
}

/** Answers from several chunks as one: items united without duplicates; single values that disagree are kept apart as a conflict. */
export function reconcile(parts: Wire[]): { merged: Wire; conflicts: Field[]; spans: Field[] } {
  if (parts.length === 1) return { merged: parts[0]!, conflicts: [], spans: [] }
  const conflicts: Field[] = []
  const spans: Field[] = []
  const anyStated = (f: Field) => (parts.some((x) => x[f].status === 'stated') ? 'stated' : 'not_found') as 'stated' | 'not_found'
  // One item read twice (chunk overlap, page and PDF) merges; two items sharing a passage stay two.
  const uniq = <T extends { quote: string }>(items: T[], key: (t: T) => string) => {
    const out: T[] = []
    for (const it of items) if (!out.some((o) => sameItem(key(o), key(it)) && (sameText(o.quote, it.quote) || sameText(key(o), key(it))))) out.push(it)
    return out
  }
  const elig = uniq(parts.flatMap((x) => x.eligibility.items), (i) => i.rule)
  const docs = uniq(parts.flatMap((x) => x.documents.items), (i) => i.item)
  // A duty is one fact per kind; two readings of how often grantees report are a disagreement, not a choice.
  const allDuties = parts.flatMap((x) => x.after_award.items)
  const duties = allDuties.filter((d, i) => allDuties.findIndex((o) => o.duty === d.duty) === i)
  if (new Set(allDuties.filter((o) => o.duty === 'reports' && o.reports).map((o) => o.reports)).size > 1) conflicts.push('after_award')
  const withSteps = parts.filter((x) => x.effort.steps.length)
  if (withSteps.length > 1) spans.push('effort')
  const effort = withSteps.length === 1 ? withSteps[0]!.effort : { status: anyStated('effort'), steps: uniq(withSteps.flatMap((x) => x.effort.steps), (s) => s.step), more_after: withSteps.some((x) => x.effort.more_after) }
  const pick = <K extends 'co_finance' | 'consortium'>(f: K) => {
    const stated = parts.map((x) => x[f]).filter((v) => v.status === 'stated' && v.required !== null)
    if (new Set(stated.map((v) => v.required)).size > 1) conflicts.push(f)
    // Two readings that both give a share, ratio or amount and differ disagree.
    else if (f === 'co_finance')
      for (const k of ['min_share', 'ratio', 'min_amount'] as const) {
        const vals = new Set(stated.map((v) => JSON.stringify((v as Wire['co_finance'])[k])).filter((j) => j !== 'null'))
        if (vals.size > 1 && !conflicts.includes(f)) conflicts.push(f)
      }
    // The fullest statement wins: a share or ratio beats a bare yes.
    return (stated.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0] ?? parts[0]![f]) as Wire[K]
  }
  return {
    merged: {
      eligibility: { status: anyStated('eligibility'), items: elig },
      documents: { status: anyStated('documents'), items: docs },
      effort,
      co_finance: pick('co_finance'),
      consortium: pick('consortium'),
      after_award: { status: anyStated('after_award'), items: duties },
      notes: parts.map((x) => x.notes).filter(Boolean).join(' | ').slice(0, 1000),
    },
    conflicts,
    spans,
  }
}

export async function extract(ask: Ask, p: Programme, chunks: Chunk[], focus?: Field[]) {
  const parts: (Wire & { missing_documents: string[] })[] = []
  for (const c of chunks) parts.push(fromApi(await ask(p.id, SYSTEM, userPrompt(p, c, chunks.length, focus), apiWire)))
  // A document the text names as holding rules, not among those gathered, leaves coverage incomplete.
  const gathered = chunks.flatMap((c) => c.docs)
  const missing = [...new Set(parts.flatMap((x) => x.missing_documents))].filter((m) => m.trim().length > 3)
  return { ...reconcile(parts), missing, read: gathered }
}
