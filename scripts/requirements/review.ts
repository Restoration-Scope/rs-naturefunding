/**
 * The second reader for "Before you apply". Reviewers caught a wrong item in about one written item in four
 * (tests/fixtures/review-labels/), mostly things only a reader sees: so every reading gets one, from a brief
 * built here, and its verdicts are applied by code.
 *
 *   bun scripts/requirements/review.ts brief <ids…>        .cache/review/<stamp>/brief.md for the reviewer
 *   bun scripts/requirements/review.ts apply <stamp dir>   applies <stamp dir>/verdicts.jsonl
 *
 * apply refuses a review that leaves an item without a verdict or misses a planted canary (a distorted rule
 * on a real quote), restores every file if the data or a new quote fails its check, stamps the review into
 * data/requirements/<id>.json, and adds the verdicts to the label set. `bun run validate` fails a reading
 * from REVIEW_FROM on whose Before you apply items have no matching review (reviewProblems).
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Programme, Source } from '../../src/data/schema'
import { eligibilityKind } from '../../src/data/schema'
import { comparable } from '../../src/data/text'
import { formatJson } from '../refresh/json'
import { lint, lintInput } from './lint'
import { serialise } from './write'

/** Readings from this day on need a second reader before they land. */
export const REVIEW_FROM = '2026-11-24'
const STANDARDS = join('docs', 'review-standards.md')
export const standardsVersion = (text = readFileSync(STANDARDS, 'utf8')) => /^standards: (\S+)/m.exec(text)?.[1] ?? 'unknown'

export const CATEGORIES = [
  'ok', 'selection_criterion', 'restates_listing', 'says_more_than_quote', 'polarity', 'either_or_split', 'wrong_round_or_programme',
  'how_to_apply_as_rule', 'award_condition_or_duty', 'cost_exclusion_split', 'document_is_application', 'document_later_or_optional',
  'duplicate', 'step_not_a_stage', 'due_wrong', 'cofinance_wrong', 'reports_wrong', 'kind_wrong',
  'missed_hard_rule', 'missed_document', 'missed_step', 'missed_fact', 'other',
] as const
const LIST_FIELDS = ['eligibility', 'documents', 'effort'] as const
/** Fields whose quotes are pooled, not one per item: each item names the quotes that state it. */
const POOLED = ['documents', 'effort', 'after_award'] as const
const ONE_FIELDS = ['co_finance_required', 'co_finance', 'consortium_required', 'after_award'] as const
export const ITEM_FIELDS = [...LIST_FIELDS, ...ONE_FIELDS] as const
type ItemField = (typeof ITEM_FIELDS)[number]

/** One reviewer verdict; the label set (tests/fixtures/review-labels/) is these lines plus `batch`. */
export const verdict = z.object({
  batch: z.string().optional(),
  id: z.string(),
  field: z.enum(['source', ...ITEM_FIELDS]),
  index: z.number().int().min(0).nullable(),
  text: z.string(),
  quote: z.string().nullable().optional(),
  verdict: z.enum(['sound', 'wrong', 'missed']),
  category: z.enum(CATEGORIES),
  action: z.enum(['keep', 'drop', 'reword', 'replace', 'add']),
  reason: z.string(),
  /** A document, step or after_award that stays: the numbers (q0, q1… in the brief) of its field's quotes that state it. */
  quotes: z.array(z.number().int().min(0)).optional(),
  /** reword: text (and kind). replace or add: text, or value for a one-value field, with a verbatim quote and its source_url. due: an effort step's date, or null. */
  new: z
    .object({ text: z.string().optional(), kind: eligibilityKind.optional(), value: z.unknown().optional(), due: z.iso.date().nullable().optional(), quote: z.string().optional(), source_url: z.url().optional() })
    .optional(),
})
export type Verdict = z.infer<typeof verdict>

/** What makes a verdict usable; the label set from before this command predates these rules. */
export function verdictProblem(v: Verdict): string | null {
  const ok: Record<Verdict['verdict'], Verdict['action'][]> = { sound: ['keep'], wrong: ['drop', 'reword', 'replace'], missed: ['add'] }
  if (!ok[v.verdict].includes(v.action)) return `a ${v.verdict} item takes ${ok[v.verdict].join(' or ')}, not ${v.action}`
  if (v.verdict === 'missed' && v.index !== null) return 'a missed fact has index null'
  if (v.verdict !== 'missed' && v.index === null) return 'a written item has its index'
  if (v.field === 'source' && !['keep', 'drop'].includes(v.action)) return 'a source is kept or dropped'
  const n = v.new ?? {}
  const one = (ONE_FIELDS as readonly string[]).includes(v.field)
  if (one && v.action === 'reword') return `${v.field} is replaced with new.value, not reworded`
  if (one && (v.action === 'replace' || v.action === 'add') && n.value === undefined) return `${v.action} on ${v.field} needs new.value`
  if (n.due !== undefined && v.field !== 'effort') return 'new.due is for effort steps'
  const pooled = (POOLED as readonly string[]).includes(v.field)
  if (v.quotes?.length && !pooled) return 'quotes is for documents, effort and after_award'
  if (pooled && (v.action === 'keep' || v.action === 'reword') && !v.quotes?.length) return `name the quotes (q0, q1…) that state this ${v.field === 'effort' ? 'step' : 'item'} in quotes`
  if (v.action === 'reword' && !n.text && n.due === undefined) return 'reword needs new.text'
  if ((v.action === 'replace' || v.action === 'add') && (!n.quote || !n.source_url)) return `${v.action} needs new.quote and new.source_url`
  if (!one && n.value !== undefined) return `new.value is for ${ONE_FIELDS.join(', ')}; ${v.field} takes new.text`
  if (!one && (v.action === 'replace' || v.action === 'add') && !n.text) return `${v.action} on ${v.field} needs new.text`
  return null
}

export type Item = { field: ItemField | 'source'; index: number; text: string; quote: string | null; source: number | null }
type Ev = { source_url: string; quote: string; checked_at: string; method: string }
type P = Record<string, any>

const describe = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))

/** Every item a reviewer gives a verdict on, sources included, numbered as in the brief. */
export function itemsOf(p: P): Item[] {
  const ev = p.evidence ?? {}
  const urls: string[] = []
  const src = (e?: Ev) => {
    if (!e) return null
    if (!urls.includes(e.source_url)) urls.push(e.source_url)
    return urls.indexOf(e.source_url)
  }
  const out: Item[] = []
  ;(p.eligibility ?? []).forEach((e: P, i: number) => out.push({ field: 'eligibility', index: i, text: e.rule, quote: ev.eligibility?.[i]?.quote ?? null, source: src(ev.eligibility?.[i]) }))
  ;(p.documents ?? []).forEach((d: string, i: number) => out.push({ field: 'documents', index: i, text: d, quote: null, source: null }))
  ;(p.effort?.steps ?? []).forEach((s: string, i: number) => out.push({ field: 'effort', index: i, text: s, quote: null, source: null }))
  for (const f of ONE_FIELDS) {
    const v = p[f]
    if (v === null || v === undefined) continue
    const e: Ev | undefined = Array.isArray(ev[f]) ? ev[f][0] : ev[f]
    out.push({ field: f, index: 0, text: describe(v), quote: e?.quote ?? null, source: src(e) })
  }
  for (const f of ['documents', 'effort', 'after_award']) for (const e of ev[f] ?? []) src(e)
  urls.forEach((u, i) => out.push({ field: 'source', index: i, text: u, quote: null, source: null }))
  return out
}

/** What a review is bound to: the written items and their quotes, not the day they were last checked or key order. */
export function itemsHash(p: P): string {
  const ev = p.evidence ?? {}
  const strip = (e: unknown): unknown => (Array.isArray(e) ? e.map(strip) : e && typeof e === 'object' ? { source_url: (e as Ev).source_url, quote: (e as Ev).quote } : e)
  const canon = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon((x as P)[k])])) : x
  const picked = Object.fromEntries(ITEM_FIELDS.map((f) => [f, [canon(p[f] ?? null), strip(ev[f]) ?? null]]))
  return createHash('sha256').update(JSON.stringify(picked)).digest('hex').slice(0, 16)
}

const droppedUrls = (p: P, verdicts: Verdict[]) => {
  const sources = itemsOf(p).filter((x) => x.field === 'source')
  return new Set(verdicts.filter((v) => v.id === p.id && v.field === 'source' && v.action === 'drop').map((v) => sources[v.index!]?.text))
}

export const hasItems = (p: P) => ITEM_FIELDS.some((f) => p[f] !== null && p[f] !== undefined)

// ---- brief ----

export type Canary = { id: string; field: 'eligibility' | 'documents'; index: number; text: string; kind?: string; quote?: string; source_url?: string }

/** A rule its quote doesn't state, on a real quote (one with no number, in any language), or a document no quote
 * names: only a reader who checks the quotes catches it. */
export function canaryFor(p: P, seed: number): Canary | null {
  // Numbers in words too (3 and 7 in the site's main languages), since the planted rules use them.
  const numeric = /\d|\b(years?|income|revenue|turnover|budget|three|seven|tres|três|trois|drei|tre|siete|sete|sept|sieben|sette)\b/i
  const quotes: Ev[] = (p.evidence?.eligibility ?? []).filter((e: Ev) => !numeric.test(e.quote))
  if (quotes.length) {
    const e = quotes[seed % quotes.length]!
    const texts = [
      ['Operating for at least 7 years', 'track_record'],
      ['Annual income of at least 250,000 in the local currency', 'finances'],
      ['Has completed 3 projects of the same kind', 'track_record'],
    ] as const
    const [text, kind] = texts[seed % texts.length]!
    return { id: p.id, field: 'eligibility', index: (p.eligibility ?? []).length, text, kind, quote: e.quote, source_url: e.source_url }
  }
  // A document none listed resembles (documents are written in English).
  const docs = [
    ['Letters of reference from three past funders', /referen/i],
    ['Audited accounts for the last five years', /audit|accounts|financial statement/i],
  ] as const
  const free = p.documents?.length ? docs.filter(([, r]) => !p.documents.some((d: string) => r.test(d))) : []
  if (free.length) return { id: p.id, field: 'documents', index: p.documents.length, text: free[seed % free.length]![0] }
  return null
}

export function brief(programmes: P[], opts: { stamp: string; dir: string; standards: string; worktree: string }) {
  const canaries: Canary[] = []
  // About one programme in three carries a canary, at least one per brief.
  programmes.forEach((p, i) => {
    if (i % 3 !== 0 && canaries.length) return
    const c = canaryFor(p, i + opts.stamp.length)
    if (c) canaries.push(c)
  })
  if (programmes.length && !canaries.length) throw new Error('no programme here can carry a canary (a rule on a quote with no number, or a document): add one that can, so the reviewer is tested')
  const verdicts = join(opts.dir, 'verdicts.jsonl')
  const out: string[] = [
    `# Review ${opts.stamp}`,
    '',
    `You are the second reader for naturefunding.org. A model extracted the "Before you apply" items below from funders' pages. Check each against the documents it cites, as an applicant would read them. Edit no file except \`${verdicts}\`. No subagents.`,
    '',
    `Worktree: ${opts.worktree}. Field rules: data/README.md (eligibility to after_award). Read each cited document (WebFetch; PDFs and linked guidelines too). If a page refuses you, \`bun scripts/requirements/browser-reads.ts text '<url>'\` prints our stored copy; a quote found only there is fine.`,
    '',
    'Write one JSON object per line to the verdicts file, one for every numbered item and every source (S0, S1…), plus one per fact the extraction missed:',
    '',
    '```',
    '{"id":"…","field":"source|eligibility|documents|effort|co_finance_required|co_finance|consortium_required|after_award","index":0,"text":"the item as written","verdict":"sound|wrong|missed","category":"ok|…","action":"keep|drop|reword|replace|add","reason":"≤25 words","quotes":[0],"new":{"text":"…","kind":"legal","value":…,"quote":"verbatim","source_url":"https://…"}}',
    '```',
    '',
    '- sound → keep, category ok. wrong → drop, reword (new.text, new.kind) or replace (new text or value, quote and source_url). missed → add, index null, with new text or value, quote and source_url.',
    '- A source that is not this programme or this round: wrong, drop, category wrong_round_or_programme; then every item it supports is wrong too.',
    '- co_finance_required and consortium_required values are true or false; co_finance and after_award values are objects as data/README.md describes. These one-value fields are replaced with new.value (every duty in one object), never reworded.',
    '- A wrong effort date: reword or replace the step with new.due (YYYY-MM-DD, or null when no quote states it).',
    '- Documents, effort steps and after_award are stated by a pool of quotes (q0, q1…). For each one you keep or reword, list in quotes the numbers of the quotes that state it (a step: its date too); for a replace, the old quotes that still state it. Never name a quote from a source you drop. Quotes no kept item names are removed.',
    '- New quotes are copied verbatim from a page our quote checker can fetch (not SharePoint, not ZIPs), at most 400 characters.',
    '- Code leads below are hints from scripts/requirements/lint.ts, not verdicts.',
    '',
    opts.standards.trim(),
    '',
  ]
  for (const p of programmes) {
    const items = itemsOf(p)
    const c = canaries.find((x) => x.id === p.id)
    const ev = p.evidence ?? {}
    const sources = items.filter((x) => x.field === 'source')
    const sIndex = (url?: string) => sources.findIndex((s) => s.text === url)
    const call = p.calls?.find((x: P) => x.url)?.url ?? p.url
    out.push(`## ${p.id}: ${p.name}`, '', `Call page: ${call}. Listing: ${p.geography?.label ?? p.geography?.scope}; applicants ${(p.applicant_types ?? []).join(', ') || 'unstated'}; amount ${describe(p.amount ?? 'unstated')}.`, '')
    const leads = lint(lintInput(p))
    if (leads.length) out.push('Code leads:', ...leads.map((l) => `- ${l.field} ${l.index}: ${l.why}`), '')
    out.push('Sources (is each this programme and the current round?):', ...sources.map((s) => `- S${s.index} ${s.text}`), '')
    const elig = items.filter((x) => x.field === 'eligibility')
    if (elig.length || c?.field === 'eligibility') {
      out.push('Eligibility:')
      for (const x of elig) out.push(`${x.index}. ${x.text} [${p.eligibility[x.index].kind}] (S${x.source}) "${x.quote}"`)
      if (c?.field === 'eligibility') out.push(`${c.index}. ${c.text} [${c.kind}] (S${sIndex(c.source_url)}) "${c.quote}"`)
      out.push('')
    }
    const qLines = (quotes: Ev[] | undefined) => (quotes ?? []).map((e: Ev, i: number) => `   q${i} (S${sIndex(e.source_url)}): "${e.quote}"`)
    for (const [f, label] of [['documents', 'Documents'], ['effort', 'Effort steps']] as const) {
      const list = items.filter((x) => x.field === f)
      if (!list.length) continue
      out.push(`${label}:`, ...list.map((x) => `${x.index}. ${x.text}${f === 'effort' && p.effort?.due ? ` (due ${p.effort.due[x.index] ?? 'none'})` : ''}`))
      if (f === 'documents' && c?.field === 'documents') out.push(`${c.index}. ${c.text}`)
      out.push(...qLines(ev[f]), '')
    }
    for (const x of items.filter((y) => (ONE_FIELDS as readonly string[]).includes(y.field)))
      out.push(...(x.field === 'after_award' ? [`after_award 0: ${x.text}`, ...qLines(ev.after_award)] : [`${x.field} 0: ${x.text} (S${x.source}) "${x.quote}"`]))
    out.push('')
  }
  const key = { stamp: opts.stamp, standards: standardsVersion(opts.standards), canaries, hashes: Object.fromEntries(programmes.map((p) => [p.id, itemsHash(p)])) }
  return { text: out.join('\n'), key, verdicts }
}

// ---- apply ----

export type Key = ReturnType<typeof brief>['key']

/** Why this review can't be applied, per programme; empty when every item has its verdict and every canary was caught. */
export function reviewGaps(programmes: P[], key: Key, verdicts: Verdict[]): string[] {
  const gaps: string[] = []
  for (const c of key.canaries) {
    const v = verdicts.find((x) => x.id === c.id && x.field === c.field && x.index === c.index)
    if (!v || v.verdict !== 'wrong' || comparable(v.text).slice(0, 30) !== comparable(c.text).slice(0, 30)) gaps.push(`${c.id}: canary "${c.text}" (${c.field} ${c.index}) was not caught: the review is not trusted; brief another reviewer`)
  }
  for (const v of verdicts) {
    const p = verdictProblem(v)
    if (p) gaps.push(`${v.id} ${v.field} ${v.index}: ${p}`)
    if (!(v.id in key.hashes)) gaps.push(`${v.id}: not in this brief`)
  }
  for (const p of programmes) {
    if (key.hashes[p.id] !== itemsHash(p)) gaps.push(`${p.id}: its items changed after the brief; brief it again`)
    const mine = verdicts.filter((v) => v.id === p.id && v.verdict !== 'missed' && !key.canaries.some((c) => c.id === p.id && c.field === v.field && c.index === v.index))
    const items = itemsOf(p)
    for (const it of items) {
      const vs = mine.filter((v) => v.field === it.field && v.index === it.index)
      if (vs.length !== 1) gaps.push(`${p.id} ${it.field} ${it.index}: ${vs.length} verdicts, one expected ("${it.text.slice(0, 60)}")`)
      else if (comparable(vs[0]!.text).slice(0, 30) !== comparable(it.text).slice(0, 30)) gaps.push(`${p.id} ${it.field} ${it.index}: the verdict is for "${vs[0]!.text.slice(0, 60)}", the item is "${it.text.slice(0, 60)}"`)
    }
    for (const v of mine) if (!items.some((it) => it.field === v.field && it.index === v.index)) gaps.push(`${p.id} ${v.field} ${v.index}: no such item`)
    for (const v of mine) for (const q of v.quotes ?? []) if (!p.evidence?.[v.field]?.[q]) gaps.push(`${p.id} ${v.field} ${v.index}: no quote q${q}`)
    // Nothing that stays may rest on a dropped source: a rule on its quote, a pooled item naming one of its quotes, a new quote.
    const dropped = droppedUrls(p, verdicts)
    const srcIndex = new Map(items.filter((x) => x.field === 'source').map((x) => [x.text, x.index]))
    for (const v of mine.filter((x) => x.action !== 'drop')) {
      const it = items.find((x) => x.field === v.field && x.index === v.index)
      if (!it || it.field === 'source') continue
      if ((POOLED as readonly string[]).includes(it.field)) {
        const q = (v.quotes ?? []).find((i) => dropped.has(p.evidence?.[it.field]?.[i]?.source_url))
        if (q !== undefined) gaps.push(`${p.id} ${it.field} ${it.index}: its source was dropped (q${q}), but the item keeps it`)
      } else if (v.action !== 'replace' && it.source !== null && [...dropped].some((u) => srcIndex.get(u) === it.source))
        gaps.push(`${p.id} ${it.field} ${it.index}: its source was dropped, but the item is kept`)
    }
    for (const v of verdicts.filter((x) => x.id === p.id && x.new?.source_url && dropped.has(x.new.source_url)))
      gaps.push(`${p.id} ${v.field} ${v.index ?? 'new'}: its new quote cites a dropped source`)
    // A one-value field takes one change; an existing one is replaced, not added to.
    for (const f of ONE_FIELDS) {
      const changes = verdicts.filter((v) => v.id === p.id && v.field === f && v.action !== 'keep')
      if (changes.length > 1) gaps.push(`${p.id} ${f}: ${changes.length} changes, one at most (put every duty in one new.value)`)
      if (p[f] !== null && p[f] !== undefined && changes.some((v) => v.action === 'add')) gaps.push(`${p.id} ${f}: already stated; replace it instead of adding`)
    }
  }
  return [...new Set(gaps)]
}

/** The programme with the verdicts applied: rewording first, then drops from the end, then additions. */
export function applyVerdicts(p0: P, verdicts: Verdict[], today: string): P {
  const p: P = structuredClone(p0)
  p.evidence ??= {}
  const ev = (v: Verdict): Ev => ({ source_url: v.new!.source_url!, quote: v.new!.quote!, checked_at: today, method: 'page' })
  // A new quote that can't be kept would leave its item unsupported: refuse instead.
  const addQuote = (f: 'documents' | 'effort', e: Ev, room: number) => {
    const list: Ev[] = (p.evidence[f] ??= [])
    if (list.some((x) => x.source_url === e.source_url && comparable(x.quote) === comparable(e.quote))) return
    if (list.length >= room) throw new Error(`${p.id} ${f}: already ${list.length} quotes, the most it takes; the new quote "${e.quote.slice(0, 50)}" can't be kept`)
    list.push(e)
  }
  const docRoom = () => Math.min(10, Math.max(3, p.documents.length))
  const setDue = (i: number, d: string | null) => {
    p.effort.due ??= p.effort.steps.map(() => null)
    p.effort.due[i] = d
  }
  const mine = verdicts.filter((v) => v.id === p.id && v.field !== 'source')
  // A pooled quote stays only when an item that stays names it and its source stays.
  const dropped = droppedUrls(p0, verdicts)
  for (const f of POOLED) {
    const named = new Set(mine.filter((v) => v.field === f && v.action !== 'drop').flatMap((v) => v.quotes ?? []))
    if (p.evidence[f]) p.evidence[f] = p.evidence[f].filter((e: Ev, i: number) => named.has(i) && !dropped.has(e.source_url))
  }
  for (const v of mine.filter((x) => x.action === 'reword' || x.action === 'replace')) {
    const i = v.index!
    if (v.field === 'eligibility') {
      const e = p.eligibility[i]
      if (v.new!.text) e.rule = v.new!.text
      if (v.new!.kind) e.kind = v.new!.kind
      if (v.action === 'replace') {
        p.evidence.eligibility[i] = ev(v)
        // A typed number has to be stated by its quote; a new quote drops it.
        delete e.min_years
        delete e.revenue
        delete e.request_cap
      }
    } else if (v.field === 'documents') {
      p.documents[i] = v.new!.text ?? p.documents[i]
      if (v.action === 'replace') addQuote('documents', ev(v), docRoom())
    } else if (v.field === 'effort') {
      p.effort.steps[i] = v.new!.text ?? p.effort.steps[i]
      if (v.new!.due !== undefined) setDue(i, v.new!.due)
      if (v.action === 'replace') addQuote('effort', ev(v), 5)
    } else setOne(p, v.field as (typeof ONE_FIELDS)[number], v.new?.value, v.action === 'replace' ? ev(v) : undefined)
  }
  const drops = mine.filter((x) => x.action === 'drop').sort((a, b) => b.index! - a.index!)
  for (const v of drops) {
    const i = v.index!
    if (v.field === 'eligibility') {
      p.eligibility.splice(i, 1)
      p.evidence.eligibility?.splice(i, 1)
    } else if (v.field === 'documents') p.documents.splice(i, 1)
    else if (v.field === 'effort') {
      p.effort.steps.splice(i, 1)
      p.effort.due?.splice(i, 1)
    } else setOne(p, v.field as (typeof ONE_FIELDS)[number], null)
  }
  for (const v of mine.filter((x) => x.action === 'add')) {
    if (v.field === 'eligibility') {
      ;(p.eligibility ??= []).push({ rule: v.new!.text!, kind: v.new!.kind ?? 'other' })
      ;(p.evidence.eligibility ??= []).push(ev(v))
    } else if (v.field === 'documents') {
      ;(p.documents ??= []).push(v.new!.text!)
      addQuote('documents', ev(v), docRoom())
    } else if (v.field === 'effort') {
      p.effort ??= { steps: [] }
      const d = v.new!.due ?? null
      if (d) p.effort.due ??= p.effort.steps.map(() => null)
      p.effort.steps.push(v.new!.text!)
      p.effort.due?.push(d)
      addQuote('effort', ev(v), 5)
    } else setOne(p, v.field as (typeof ONE_FIELDS)[number], v.new!.value, ev(v))
  }
  // An emptied list goes with its quotes; due goes when no step is dated.
  for (const f of ['eligibility', 'documents', 'effort'] as const) {
    const list = f === 'effort' ? p.effort?.steps : p[f]
    if (Array.isArray(list) && !list.length) {
      delete p[f]
      delete p.evidence[f]
    }
  }
  if (p.effort?.due?.every((d: string | null) => d === null)) delete p.effort.due
  return p
}

/** Set or clear a one-value field with its quote; a cleared co-funding requirement takes its details with it. */
function setOne(p: P, f: (typeof ONE_FIELDS)[number], value: unknown, e?: Ev) {
  const clearDetails = () => {
    delete p.co_finance
    delete p.evidence.co_finance
  }
  if (value === null || value === undefined) {
    // Not stated: co_finance_required is null, the others are left out (src/data/schema.ts).
    if (f === 'co_finance_required') p[f] = null
    else delete p[f]
    delete p.evidence[f]
    if (f === 'co_finance_required') clearDetails()
    return
  }
  p[f] = value
  // after_award keeps the old quotes its verdict named (already pruned to those) beside the new one.
  if (e && f === 'after_award') {
    const list: Ev[] = (p.evidence.after_award ?? []).filter((x: Ev) => x.source_url !== e.source_url || comparable(x.quote) !== comparable(e.quote))
    if (list.length >= 4) throw new Error(`${p.id} after_award: already ${list.length} quotes, the most it takes; the new quote "${e.quote.slice(0, 50)}" can't be kept`)
    p.evidence.after_award = [...list, e]
  } else if (e) p.evidence[f] = e
  if (f === 'co_finance_required' && value === false) clearDetails()
}

/** A model's family; the reviewer must come from another family than every model that read the programme. */
const FAMILIES: [string, RegExp][] = [['openai', /gpt|openai|codex/], ['anthropic', /claude|opus|sonnet|haiku|fable/], ['google', /gemini/], ['xai', /grok/]]
export const family = (model: string) => FAMILIES.find(([, r]) => r.test(model.toLowerCase()))?.[0] ?? model.toLowerCase()

export type Review = { on: string; standards: string; reviewer: string; hash: string; verdicts: { sound: number; wrong: number; missed: number }; canaries: { planted: number; caught: number } }

/** Readings from REVIEW_FROM on whose written items have no review, or changed since it. */
export function reviewProblems(programmes: P[], manifests: { id: string; read_on: string; review?: Review }[]): string[] {
  const byId = new Map(programmes.map((p) => [p.id, p]))
  const out: string[] = []
  const read = new Set(manifests.filter((m) => m.read_on >= REVIEW_FROM).map((m) => m.id))
  for (const p of programmes)
    if (p.requirements_checked >= REVIEW_FROM && !read.has(p.id) && hasItems(p)) out.push(`${p.id}: requirements checked ${p.requirements_checked} with no reading manifest since ${REVIEW_FROM}: read it with scripts/requirements/run.ts, then review it`)
  for (const m of manifests) {
    const p = byId.get(m.id)
    if (!p || m.read_on < REVIEW_FROM || !hasItems(p)) continue
    if (!m.review) out.push(`${m.id}: Before you apply read on ${m.read_on} has no second reader yet: bun scripts/requirements/review.ts brief ${m.id}`)
    else if (m.review.hash !== itemsHash(p)) out.push(`${m.id}: Before you apply changed after its review on ${m.review.on}: bun scripts/requirements/review.ts brief ${m.id}`)
  }
  return out
}

export function readManifests(dir = join('data', 'requirements')) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

// ---- CLI ----

const programmeFile = (id: string) => join('data', 'programmes', `${id}.json`)
const readJson = (f: string) => JSON.parse(readFileSync(f, 'utf8'))

function runBrief(ids: string[]) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join('.cache', 'review', stamp)
  mkdirSync(dir, { recursive: true })
  const missing = ids.filter((id) => !existsSync(programmeFile(id)))
  if (missing.length) throw new Error(`no such programme: ${missing.join(' ')}`)
  const ps = ids.map((id) => readJson(programmeFile(id))).filter((p) => hasItems(p))
  const b = brief(ps, { stamp, dir, standards: readFileSync(STANDARDS, 'utf8'), worktree: process.cwd() })
  writeFileSync(join(dir, 'brief.md'), b.text)
  writeFileSync(join(dir, 'key.json'), `${JSON.stringify(b.key, null, 2)}\n`)
  const skipped = ids.length - ps.length
  console.log(`${join(dir, 'brief.md')}: ${ps.length} programmes, ${b.key.canaries.length} canaries${skipped ? `, ${skipped} without items skipped` : ''}`)
  console.log(`Hand the brief to a reviewer from another model family; then: bun scripts/requirements/review.ts apply ${dir} --reviewer <model>`)
}

function runApply(dir: string, reviewer: string) {
  const key: Key = readJson(join(dir, 'key.json'))
  const lines = readFileSync(join(dir, 'verdicts.jsonl'), 'utf8').split('\n').filter((l) => l.trim())
  const verdicts: Verdict[] = []
  const bad: string[] = []
  lines.forEach((l, i) => {
    try {
      verdicts.push(verdict.parse(JSON.parse(l)))
    } catch (e) {
      bad.push(`line ${i + 1}: ${e instanceof z.ZodError ? e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') : (e as Error).message}`)
    }
  })
  const ids = Object.keys(key.hashes)
  const before = new Map(ids.map((id) => [id, readFileSync(programmeFile(id), 'utf8')]))
  const ps = ids.map((id) => JSON.parse(before.get(id)!))
  const sameFamily = ids.flatMap((id) => {
    const f = join('data', 'requirements', `${id}.json`)
    const models: string[] = existsSync(f) ? (readJson(f).models ?? []) : []
    return models.some((m) => family(m) === family(reviewer)) ? [`${id}: the reviewer ${reviewer} is the same model family as its reading (${models.join(', ')}); brief a reviewer from another family`] : []
  })
  const gaps = [...bad, ...sameFamily, ...reviewGaps(ps, key, verdicts)]
  if (gaps.length) {
    console.error(gaps.join('\n'))
    console.error(`\n${gaps.length} problems: nothing applied`)
    process.exit(1)
  }
  const today = new Date().toISOString().slice(0, 10)
  const isCanary = (v: Verdict) => key.canaries.some((c) => c.id === v.id && c.field === v.field && c.index === v.index)
  const real = verdicts.filter((v) => !isCanary(v))
  const sourcesText = readFileSync(join('data', 'sources.json'), 'utf8')
  const sources: Source[] = JSON.parse(sourcesText)
  const touched: string[] = []
  const manifestsBefore = new Map<string, string>()
  let nexts: P[]
  try {
    nexts = ps.map((p) => applyVerdicts(p, real, today))
  } catch (e) {
    console.error(`${(e as Error).message}\nnothing applied`)
    process.exit(1)
  }
  for (const [i, p] of ps.entries()) {
    const next = nexts[i]!
    if (itemsHash(next) !== itemsHash(p)) touched.push(p.id)
    writeFileSync(programmeFile(p.id), serialise(next as Programme, before.get(p.id)!))
    // A page newly cited joins the watch list, read whole (as write.ts does).
    for (const v of real.filter((x) => x.id === p.id && x.new?.source_url))
      if (!sources.some((s) => s.programme_id === p.id && s.url === v.new!.source_url)) {
        const n = Math.max(0, ...sources.filter((s) => s.programme_id === p.id).map((s) => Number(s.id.slice(p.id.length + 1)) || 0))
        const live = (p.calls ?? []).some((c: P) => c.status === 'open' || c.status === 'upcoming')
        sources.push({ id: `${p.id}-${n + 1}`, programme_id: p.id, url: v.new!.source_url!, selector: null, hint: null, cycle: live ? 'daily' : p.access === 'direct' ? 'weekly' : 'monthly' } as Source)
      }
  }
  writeFileSync(join('data', 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`)
  const restore = (why: string) => {
    for (const [id, text] of before) writeFileSync(programmeFile(id), text)
    writeFileSync(join('data', 'sources.json'), sourcesText)
    for (const [f, text] of manifestsBefore) writeFileSync(f, text)
    console.error(`${why}: every file restored, nothing applied`)
    process.exit(1)
  }
  const check = (cmd: string[]) => Bun.spawnSync(cmd, { stdout: 'inherit', stderr: 'inherit' }).exitCode === 0
  // Validate without the review gate: the stamps come after the data passes.
  if (!check(['bun', 'scripts/data/validate.ts', '--no-review'])) restore('the data fails validation')
  // Only the quotes this review adds: older quotes on these programmes are the refresh job's.
  const quoted = real.filter((v) => v.new?.quote)
  const quotesFile = join(dir, 'new-quotes.txt')
  writeFileSync(quotesFile, quoted.map((v) => [v.id, v.new!.source_url!, v.new!.quote!.replace(/\s+/g, ' ')].join('\t')).join('\n'))
  if (quoted.length && !check(['bun', 'scripts/data/verify-quotes.ts', '--fresh', '--quotes', quotesFile, ...new Set(quoted.map((v) => v.id))])) restore('a new quote is not on its page')
  for (const id of ids) {
    const f = join('data', 'requirements', `${id}.json`)
    if (!existsSync(f)) continue
    const text = readFileSync(f, 'utf8')
    manifestsBefore.set(f, text)
    const mine = real.filter((v) => v.id === id && v.field !== 'source')
    const planted = key.canaries.filter((c) => c.id === id).length
    const review: Review = {
      on: today,
      standards: key.standards,
      reviewer,
      hash: itemsHash(readJson(programmeFile(id))),
      verdicts: { sound: mine.filter((v) => v.verdict === 'sound').length, wrong: mine.filter((v) => v.verdict === 'wrong').length, missed: mine.filter((v) => v.verdict === 'missed').length },
      canaries: { planted, caught: planted },
    }
    writeFileSync(f, formatJson({ ...JSON.parse(text), review }))
  }
  mkdirSync(join('tests', 'fixtures', 'review-labels'), { recursive: true })
  appendFileSync(join('tests', 'fixtures', 'review-labels', `${today}.jsonl`), real.map((v) => `${JSON.stringify({ batch: key.stamp, ...v })}\n`).join(''))
  const wrong = real.filter((v) => v.verdict === 'wrong' && v.field !== 'source').length
  const items = real.filter((v) => v.verdict !== 'missed' && v.field !== 'source').length
  console.log(`${ids.length} programmes reviewed, ${touched.length} changed; ${wrong} of ${items} items wrong, ${real.filter((v) => v.verdict === 'missed').length} missed; ${key.canaries.length} canaries caught`)
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2)
  const flag = (name: string) => {
    const i = rest.indexOf(name)
    return i === -1 ? undefined : rest.splice(i, 2)[1]
  }
  if (cmd === 'brief' && rest.length) runBrief(rest)
  else if (cmd === 'apply' && rest.length) {
    const reviewer = flag('--reviewer')
    if (!reviewer) {
      console.error('apply needs --reviewer <model>: the model that wrote the verdicts')
      process.exit(2)
    }
    runApply(rest[0]!, reviewer)
  } else {
    console.error('usage: review.ts brief <ids…> | apply <stamp dir> --reviewer <model>')
    process.exit(2)
  }
}
