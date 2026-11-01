/**
 * Tier B: a watched page changed or lost a quote. The extractor re-reads the facts that page
 * states, each with a verbatim quote; every quote is checked against the page text by code;
 * a reviewer from another model family judges the draft against the page. The result is a
 * pull request draft (files, title, body) for a person to review.
 */
import type { Call, Evidence, Programme, Source } from '../../src/data/schema'
import { access, applicantType, approach, callStatus, programme as programmeSchema, region, window as windowSchema } from '../../src/data/schema'
import { comparable } from '../data/page-text'
import type { Llm } from './llm'
import { dateOf, evidenceRefs } from './tier'

const FIELDS = ['administered_by', 'applicant_types', 'geography', 'access', 'window', 'amount', 'co_finance_required', 'reporting'] as const
type Field = (typeof FIELDS)[number]

export type Extraction = {
  fields?: Partial<Record<Field, { value: unknown; quote: string }>>
  calls?: { id: string; label: string; url: string; status: Call['status']; opens: string | null; deadline: Call['deadline']; quotes: { status: string; opens?: string | null; deadline?: string | null } }[]
  notes?: string
}

export type Change = { path: string; kind: 'changed' | 'added' | 'requoted' | 'rejected'; old: unknown; new: unknown; quote: string; why?: string }

export type Review = { overall: 'approve' | 'reject' | 'unclear'; verdicts: { path: string; verdict: string; reason: string }[]; missed: string }

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Applies an extraction to a programme, for facts this page states. Pure. A fact moves only
 * when its quote is on the page; a fact still quoted on the page is dated today; a fact whose
 * quote is gone and that the extractor did not confirm stays as it was and is listed.
 */
export function applyExtraction(original: Programme, source: Source, x: Extraction, pageText: string, now: Date) {
  const p: Programme = structuredClone(original)
  const today = dateOf(now)
  const page = comparable(pageText)
  const onPage = (q: string | null | undefined) => !!q && q.trim().length >= 3 && page.includes(comparable(q))
  const evidence = (quote: string): Evidence => ({ source_url: source.url, quote, checked_at: today, method: 'page' })
  const changes: Change[] = []

  for (const field of FIELDS) {
    const got = x.fields?.[field]
    const old = p.evidence[field]
    if (!got || got.value === null || got.value === undefined) continue
    if (old && old.source_url !== source.url) continue
    const path = field
    if (!onPage(got.quote)) {
      changes.push({ path, kind: 'rejected', old: p[field], new: got.value, quote: got.quote, why: 'quote not on the page' })
      continue
    }
    if (same(p[field], got.value)) {
      if (old && onPage(old.quote)) old.checked_at = today
      else {
        p.evidence[field] = evidence(got.quote)
        changes.push({ path, kind: 'requoted', old: old?.quote ?? null, new: got.quote, quote: got.quote })
      }
      continue
    }
    changes.push({ path, kind: old ? 'changed' : 'added', old: p[field], new: got.value, quote: got.quote })
    ;(p as Record<string, unknown>)[field] = got.value
    p.evidence[field] = evidence(got.quote)
  }

  for (const c of x.calls ?? []) {
    const path = `calls[${c.id}]`
    const quotes = [c.quotes?.status, c.deadline ? c.quotes?.deadline : 'none', c.opens ? c.quotes?.opens : 'none']
    const missing = quotes.filter((q) => q !== 'none' && !onPage(q))
    const existing = p.calls.find((k) => k.id === c.id)
    if (existing && existing.evidence.status.source_url !== source.url) continue
    if (missing.length) {
      changes.push({ path, kind: 'rejected', old: existing ?? null, new: c, quote: missing.join(' | '), why: 'quote not on the page' })
      continue
    }
    const next: Call = {
      id: c.id, label: c.label, url: c.url, status: c.status, opens: c.opens ?? null, deadline: c.deadline ?? null,
      evidence: {
        status: evidence(c.quotes.status),
        ...(c.opens && c.quotes.opens ? { opens: evidence(c.quotes.opens) } : {}),
        ...(c.deadline && c.quotes.deadline ? { deadline: evidence(c.quotes.deadline) } : {}),
      },
    }
    const facts = (k: Call) => ({ status: k.status, opens: k.opens, deadline: k.deadline, label: k.label, url: k.url })
    if (!existing) {
      p.calls.push(next)
      changes.push({ path, kind: 'added', old: null, new: facts(next), quote: c.quotes.status })
    } else if (!same(facts(existing), facts(next))) {
      changes.push({ path, kind: 'changed', old: facts(existing), new: facts(next), quote: [c.quotes.status, c.quotes.deadline, c.quotes.opens].filter(Boolean).join(' | ') })
      p.calls[p.calls.indexOf(existing)] = next
    } else {
      for (const [k, e] of Object.entries(existing.evidence) as [keyof Call['evidence'], Evidence | undefined][]) {
        if (!e) continue
        if (onPage(e.quote)) e.checked_at = today
        else if (next.evidence[k]) existing.evidence[k] = next.evidence[k]
      }
    }
  }

  const unconfirmed: string[] = []
  for (const { path, evidence: e } of evidenceRefs(p)) {
    if (e.source_url !== source.url || e.checked_at === today) continue
    if (onPage(e.quote)) e.checked_at = today
    else unconfirmed.push(`${path}: "${e.quote}"`)
  }

  const dates = evidenceRefs(p).map((r) => r.evidence.checked_at)
  const oldest = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : p.checked_at
  if (oldest > p.checked_at) p.checked_at = oldest

  const parsed = programmeSchema.safeParse(p)
  const schemaErrors = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  return { programme: p, changes, unconfirmed, schemaErrors }
}

const EXTRACT_SYSTEM = `You read a grant funder's web page and report the facts it states about one funding programme, as JSON.
Rules:
- Only facts the page states. If the page does not state a fact, leave it out. Never guess, never infer a deadline, never invent a next round.
- Every fact carries "quote": words copied exactly from the page text, 5 to 40 words, that state the fact. No paraphrase, no ellipsis.
- Reuse the ids of the current calls when the page describes the same round. A new round gets a new lowercase-kebab-case id.
- Dates are YYYY-MM-DD. A deadline is {"date","time"?: "HH:MM","timezone"?: as written or IANA,"text": the deadline as the funder wrote it}.
Answer with one JSON object:
{"fields": {"<field>": {"value": <value in the schema below>, "quote": "..."}},
 "calls": [{"id","label","url","status","opens","deadline","quotes": {"status": "...","opens": "...","deadline": "..."}}],
 "notes": "anything a reviewer should know, e.g. facts the page now contradicts"}
Fields and values:
- administered_by: {"name","url"} of who runs the call for the funder
- applicant_types: array of ${applicantType.options.join(', ')}
- geography: {"scope":"global"} | {"scope":"countries","countries":[ISO-2 codes],"label"?} | {"scope":"regions","regions":[${region.options.join(', ')}],"label"}
- access: ${access.options.filter((o) => o !== 'unspecified').join(', ')}
- window: ${windowSchema.options.filter((o) => o !== 'unspecified').join(', ')}
- amount: {"currency": ISO 4217,"min"?: number,"max"?: number} per grant
- co_finance_required: true | false
- reporting: what grantees must report, in plain words
- call status: ${callStatus.options.join(', ')}
(Approaches, for context only: ${approach.options.join(', ')}.)`

const REVIEW_SYSTEM = `You check a draft of facts about a grant programme against the funder's page text. Another model wrote the draft; be strict.
For each item, say whether the page text supports the new value: "supported", "unsupported" or "unclear", with a short reason.
Also say what the draft missed that the page states and that contradicts the current facts (a changed deadline, amount, eligibility or status), or "" if nothing.
Answer with one JSON object: {"verdicts":[{"path","verdict","reason"}],"overall":"approve"|"reject"|"unclear","missed":"..."}`

function current(p: Programme, source: Source) {
  return {
    programme: { id: p.id, name: p.name, funder: p.funder.name },
    facts_citing_this_page: Object.fromEntries(
      FIELDS.filter((f) => p.evidence[f]?.source_url === source.url).map((f) => [f, { value: p[f], quote: p.evidence[f]!.quote }]),
    ),
    calls: p.calls.map((c) => ({ id: c.id, label: c.label, url: c.url, status: c.status, opens: c.opens, deadline: c.deadline })),
  }
}

export type Draft = {
  source: Source
  programme_id: string
  hash: string
  reasons: string[]
  files: Record<string, string>
  title: string
  body: string
  /** True when the draft changes no fact: only dates, quotes and the accepted hash. */
  datesOnly: boolean
  review: Review | null
  error: string | null
}

export async function extractAndReview(llm: Llm, p: Programme, source: Source, pageText: string, now: Date) {
  const truncated = pageText.length > llm.maxChars
  const text = pageText.slice(0, llm.maxChars)
  const hint = source.hint ? `\nWhere to look: ${source.hint}` : ''
  const extraction = (await llm.chat(
    llm.extractor,
    EXTRACT_SYSTEM,
    `Current facts on our site:\n${JSON.stringify(current(p, source), null, 1)}${hint}\n\nPage ${source.url}, text${truncated ? ' (cut)' : ''}:\n"""\n${text}\n"""`,
  )) as Extraction
  const applied = applyExtraction(p, source, extraction, pageText, now)
  const items = applied.changes.length
    ? applied.changes.map((c) => ({ path: c.path, old: c.old, new: c.new, quote: c.quote }))
    : [{ path: '(no fact changed)', old: current(p, source), new: 'unchanged', quote: '' }]
  const review = (await llm.chat(
    llm.reviewer,
    REVIEW_SYSTEM,
    `Draft items:\n${JSON.stringify(items, null, 1)}\n\nPage ${source.url}, text${truncated ? ' (cut)' : ''}:\n"""\n${text}\n"""`,
  )) as Review
  return { ...applied, extraction, review, truncated }
}
