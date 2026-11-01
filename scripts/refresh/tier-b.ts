/**
 * Tier B: a watched page changed or lost a quote. The extractor re-reads the facts that page
 * states, each with a verbatim quote; every quote is checked against the page text by code;
 * a reviewer from another model family judges the draft against the page. The result is a
 * pull request draft (files, title, body) for a person to review.
 */
import type { z } from 'zod'
import type { Call, Evidence, Programme, Source } from '../../src/data/schema'
import {
  access, applicantType, approach, call as callSchema, callStatus, programme as programmeSchema, region, window as windowSchema,
} from '../../src/data/schema'
import { comparable } from '../data/page-text'
import type { Llm } from './llm'
import { dateOf, evidenceRefs } from './tier'

const FIELDS = ['administered_by', 'applicant_types', 'geography', 'access', 'window', 'amount', 'co_finance_required', 'reporting'] as const

/** The model's answer, untrusted: every piece is parsed against the schema before use. */
export type Extraction = { fields?: unknown; calls?: unknown; notes?: unknown }

export type Change = { path: string; kind: 'changed' | 'added' | 'requoted' | 'rejected'; old: unknown; new: unknown; quote: string; why?: string }

export type Review = { overall: 'approve' | 'reject' | 'unclear'; verdicts: { path: string; verdict: string; reason: string }[]; missed: string }

export const MAX_QUOTE = 300
const MAX_LABEL = 200

/** JSON with sorted keys, so key order never counts as a difference. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b)
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The value as the schema reads it. Unknown keys are refused, not silently dropped. */
function fit<T>(schema: z.ZodType<T>, value: unknown): { ok: true; value: T } | { ok: false; why: string } {
  const r = schema.safeParse(value)
  if (!r.success) return { ok: false, why: `does not fit the schema (${r.error.issues[0]?.path.join('.') || 'value'}: ${r.error.issues[0]?.message})` }
  if (!same(r.data, value)) return { ok: false, why: 'has keys the schema does not know' }
  return { ok: true, value: r.data }
}

/**
 * Applies an extraction to a programme, for facts this page states. Pure. A fact moves only
 * when its value fits the schema and its quote (at most MAX_QUOTE characters) is on the page;
 * a fact still quoted on the page is dated today; a fact whose quote is gone and that the
 * extractor did not confirm stays as it was and is listed. `programme` is the schema's parsed
 * value, or null when the draft fails the schema.
 */
export function applyExtraction(original: Programme, source: Source, x: Extraction, pageText: string, now: Date) {
  const p: Programme = structuredClone(original)
  const today = dateOf(now)
  const page = comparable(pageText)
  const onPage = (q: unknown): q is string => typeof q === 'string' && q.trim().length >= 3 && q.length <= MAX_QUOTE && page.includes(comparable(q))
  const quoteWhy = (q: unknown) => (typeof q === 'string' && q.length > MAX_QUOTE ? `quote longer than ${MAX_QUOTE} characters` : 'quote not on the page')
  const short = (q: unknown) => (typeof q === 'string' ? q.slice(0, MAX_QUOTE) : '')
  const evidence = (quote: string): Evidence => ({ source_url: source.url, quote, checked_at: today, method: 'page' })
  const changes: Change[] = []
  const fields = isRecord(x.fields) ? x.fields : {}

  for (const field of FIELDS) {
    const got = fields[field]
    const old = p.evidence[field]
    if (!isRecord(got) || got.value === null || got.value === undefined) continue
    if (old && old.source_url !== source.url) continue
    const path = field
    const value = fit(programmeSchema.shape[field] as z.ZodType<unknown>, got.value)
    if (!value.ok) {
      changes.push({ path, kind: 'rejected', old: p[field], new: '(not shown)', quote: short(got.quote), why: `value ${value.why}` })
      continue
    }
    if (!onPage(got.quote)) {
      changes.push({ path, kind: 'rejected', old: p[field], new: value.value, quote: short(got.quote), why: quoteWhy(got.quote) })
      continue
    }
    if (same(p[field], value.value)) {
      if (old && onPage(old.quote)) old.checked_at = today
      else {
        p.evidence[field] = evidence(got.quote)
        changes.push({ path, kind: 'requoted', old: old?.quote ?? null, new: got.quote, quote: got.quote })
      }
      continue
    }
    changes.push({ path, kind: old ? 'changed' : 'added', old: p[field], new: value.value, quote: got.quote })
    ;(p as Record<string, unknown>)[field] = value.value
    p.evidence[field] = evidence(got.quote)
  }

  for (const raw of Array.isArray(x.calls) ? x.calls : []) {
    if (!isRecord(raw)) continue
    const c = raw
    const quotes = isRecord(c.quotes) ? c.quotes : {}
    const path = `calls[${short(c.id).slice(0, 80)}]`
    const existing = p.calls.find((k) => k.id === c.id)
    if (existing && existing.evidence.status.source_url !== source.url) continue
    const needed = [quotes.status, c.deadline ? quotes.deadline : null, c.opens ? quotes.opens : null].filter((q) => q !== null)
    const missing = needed.filter((q) => !onPage(q))
    const candidate = {
      id: c.id, label: c.label, url: c.url, status: c.status, opens: c.opens ?? null, deadline: c.deadline ?? null,
      evidence: {
        status: evidence(short(quotes.status)),
        ...(c.opens ? { opens: evidence(short(quotes.opens)) } : {}),
        ...(c.deadline ? { deadline: evidence(short(quotes.deadline)) } : {}),
      },
    }
    const parsed = fit(callSchema, candidate)
    const why = !parsed.ok
      ? `call ${parsed.why}`
      : typeof c.label === 'string' && c.label.length > MAX_LABEL ? `label longer than ${MAX_LABEL} characters`
      : missing.length ? quoteWhy(missing[0]) : null
    if (!parsed.ok || why) {
      changes.push({ path, kind: 'rejected', old: existing ?? null, new: '(not shown)', quote: missing.map(short).join(' | '), why: why! })
      continue
    }
    const next = parsed.value
    const facts = (k: Call) => ({ status: k.status, opens: k.opens, deadline: k.deadline, label: k.label, url: k.url })
    const quoteText = [next.evidence.status, next.evidence.deadline, next.evidence.opens].flatMap((e) => (e ? [e.quote] : [])).join(' | ')
    if (!existing) {
      p.calls.push(next)
      changes.push({ path, kind: 'added', old: null, new: facts(next), quote: quoteText })
    } else if (!same(facts(existing), facts(next))) {
      changes.push({ path, kind: 'changed', old: facts(existing), new: facts(next), quote: quoteText })
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
  const notes = typeof x.notes === 'string' ? x.notes.slice(0, 1000) : ''
  return { programme: parsed.success ? parsed.data : null, changes, unconfirmed, schemaErrors, notes }
}

const EXTRACT_SYSTEM = `You read a grant funder's web page and report the facts it states about one funding programme, as JSON.
Rules:
- Only facts the page states. If the page does not state a fact, leave it out. Never guess, never infer a deadline, never invent a next round.
- Every fact carries "quote": words copied exactly from the page text, 5 to 40 words, that state the fact. No paraphrase, no ellipsis.
- Reuse the ids of the current calls when the page describes the same round. A new round gets a new lowercase-kebab-case id.
- Dates are YYYY-MM-DD. The quote for an opening date or deadline must contain its year as the page writes it; if the page gives no year, leave the date out. A deadline is {"date","time"?: "HH:MM","timezone"?: as written or IANA,"text": the deadline as the funder wrote it}.
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

const withoutDates = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(withoutDates)
  : isRecord(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'checked_at').map(([k, x]) => [k, withoutDates(x)]))
  : v

/**
 * What a proposal says, as one hash: the page, the page version and the facts it proposes,
 * leaving out check dates, which move every day without changing the proposal.
 */
export function proposalKey(sourceId: string, pageHash: string, p: Programme): string {
  return new Bun.CryptoHasher('sha256').update(canon({ source: sourceId, page: pageHash, programme: withoutDates(p) })).digest('hex')
}

export type Draft = {
  source: Source
  programme_id: string
  hash: string
  /** proposalKey of the draft; null when it opens an issue instead of a PR. */
  key: string | null
  reasons: string[]
  files: Record<string, string>
  title: string
  body: string
  /** True when the draft changes no fact: only dates, quotes and the accepted hash. */
  datesOnly: boolean
  review: Review | null
  error: string | null
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** The reviewer's answer, kept to the shape and lengths the PR body shows. */
export function readReview(answer: unknown): Review {
  const a = isRecord(answer) ? answer : {}
  const overall = a.overall === 'approve' || a.overall === 'reject' ? a.overall : 'unclear'
  const verdicts = (Array.isArray(a.verdicts) ? a.verdicts : []).filter(isRecord).slice(0, 50)
    .map((v) => ({ path: clip(v.path, 120), verdict: clip(v.verdict, 20), reason: clip(v.reason, 300) }))
  return { overall, verdicts, missed: clip(a.missed, 1000) }
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
  const answer = await llm.chat(
    llm.reviewer,
    REVIEW_SYSTEM,
    `Draft items:\n${JSON.stringify(items, null, 1)}\n\nPage ${source.url}, text${truncated ? ' (cut)' : ''}:\n"""\n${text}\n"""`,
  )
  return { ...applied, review: readReview(answer), truncated }
}
