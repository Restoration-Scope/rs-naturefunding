/**
 * Stage 4, verify: code holds the extractor's answer to every rule it can state. Each quote must be on the
 * document it names, each due date stated whole by its quote (and not readable two ways), each typed number
 * stated by its rule's quote, and every value must fit the strict schema. A failure rejects the item, not
 * the programme; rejected items go to the strong model with the reason.
 */
import { z } from 'zod'
import { eligibilityKind, isoDate, requestCap, revenueRange, statesDate } from '../../src/data/schema'
import { comparable, normalise, quoteOnPage } from '../../src/data/text'
import { numbersIn, statesCurrency, thresholdProblems } from '../../src/data/thresholds'
import type { Doc } from './gather'
import type { Field, Wire } from './extract'

export type Quote = { doc: string; quote: string }
export type EligItem = { rule: string; kind: z.infer<typeof eligibilityKind>; min_years?: number; revenue?: z.infer<typeof revenueRange>; request_cap?: z.infer<typeof requestCap>; q: Quote }
export type DocItem = { item: string; q: Quote }
export type Step = { step: string; due: string | null; q: Quote }
export type Duty = { duty: 'reports' | 'audit' | 'site_visits' | 'training'; reports?: 'final' | 'interim_and_final' | 'yearly' | 'twice_yearly' | 'quarterly' | 'other' | 'unspecified'; q: Quote }
export type CoFinance = { min_share?: number; ratio?: string; min_amount?: { value: number; currency: string }; in_kind?: true; applies_to?: string; q: Quote }

/** Verified facts in the schema's terms, each with the quote that states it. */
export type Facts = {
  eligibility: EligItem[]
  documents: DocItem[]
  effort: { steps: Step[]; more_after: boolean } | null
  co_finance_required: { value: boolean; q: Quote } | null
  co_finance: CoFinance | null
  consortium_required: { value: boolean; q: Quote } | null
  after_award: Duty[]
}

/** Something code or Jev found wrong with one item, kept for escalation and the manifest. */
export type Flag = { field: Field; item: string; why: string; quote?: string; doc?: string; source: 'verify' | 'jev'; p?: number }

export const emptyFacts = (): Facts => ({ eligibility: [], documents: [], effort: null, co_finance_required: null, co_finance: null, consortium_required: null, after_award: [] })

const byRef = (docs: Doc[]) => new Map(docs.map((d) => [d.ref, { doc: d, page: comparable(d.text) }]))

/** The document a quote is on: the one it names, else any gathered document that has it (models misnumber). */
export function locate(docs: Doc[], q: { doc: string | null; quote: string | null }): Quote | null {
  if (!q.quote) return null
  const quote = normalise(q.quote).replace(/^["'«»]+|["'«»]+$/g, '')
  if (quote.length > 400) return null
  const pages = byRef(docs)
  const named = q.doc ? pages.get(q.doc) : undefined
  if (named && quoteOnPage(named.page, quote)) return { doc: named.doc.ref, quote }
  for (const { doc, page } of pages.values()) if (quoteOnPage(page, quote)) return { doc: doc.ref, quote }
  return null
}

/** A numeric date written so day and month can swap ("04/05/2027") with no DD/MM or MM/DD beside it: statesDate
 * refuses it, and it is flagged for a person rather than left silently undated. */
export function readsTwoWays(quote: string, date: string) {
  const [y, m, d] = [date.slice(0, 4), Number(date.slice(5, 7)), Number(date.slice(8))]
  if (m === d || d > 12) return false
  const yy = `(?:${y}|${y.slice(2)})`
  const either = new RegExp(String.raw`(?<![\p{L}\d])(?:0?${d}[/-]0?${m}|0?${m}[/-]0?${d})[/-]${yy}(?![\p{L}\d])`, 'u')
  return either.test(quote) && !statesDate(quote, date)
}

const len = (s: string, min: number, max: number) => s.trim().length >= min && s.trim().length <= max

export function verify(w: Wire, docs: Doc[]): { facts: Facts; flags: Flag[]; notes: string[] } {
  const facts = emptyFacts()
  const flags: Flag[] = []
  const notes: string[] = []
  const reject = (field: Field, item: string, why: string, q?: { doc: string | null; quote: string | null }) =>
    flags.push({ field, item, why, quote: q?.quote ?? undefined, doc: q?.doc ?? undefined, source: 'verify' })

  for (const e of w.eligibility.status === 'stated' ? w.eligibility.items : []) {
    const q = locate(docs, e)
    if (!q) {
      reject('eligibility', e.rule, 'the quote is not on any gathered document', e)
      continue
    }
    if (!len(e.rule, 5, 120)) {
      reject('eligibility', e.rule, 'a rule is 5 to 120 characters', e)
      continue
    }
    const item: EligItem = { rule: e.rule.trim(), kind: e.kind, q }
    if (e.min_years !== null) {
      if (e.kind !== 'track_record') notes.push(`eligibility "${e.rule}": years operating dropped, not a track_record rule`)
      else item.min_years = e.min_years
    }
    if (e.revenue) {
      const r = revenueRange.safeParse(Object.fromEntries(Object.entries(e.revenue).filter(([, v]) => v !== null)))
      if (e.kind !== 'finances') notes.push(`eligibility "${e.rule}": revenue range dropped, not a finances rule`)
      else if (!r.success) notes.push(`eligibility "${e.rule}": revenue range dropped: ${r.error.issues[0]?.message}`)
      else item.revenue = r.data
    }
    if (e.request_cap) {
      const r = requestCap.safeParse(e.request_cap)
      if (e.kind !== 'finances') notes.push(`eligibility "${e.rule}": request cap dropped, not a finances rule`)
      else if (!r.success) notes.push(`eligibility "${e.rule}": request cap dropped: ${r.error.issues[0]?.message}`)
      else item.request_cap = r.data
    }
    // A typed number its quote doesn't state is dropped; the rule stays as text.
    for (const t of thresholdProblems(item, q.quote)) {
      notes.push(`eligibility "${e.rule}": ${t.key} dropped: ${t.why}`)
      delete item[t.key]
    }
    if (facts.eligibility.some((x) => comparable(x.rule) === comparable(item.rule))) continue
    facts.eligibility.push(item)
  }
  if (facts.eligibility.length > 8) {
    notes.push(`eligibility: ${facts.eligibility.length - 8} rules past the 8th dropped`)
    facts.eligibility = facts.eligibility.slice(0, 8)
  }

  for (const d of w.documents.status === 'stated' ? w.documents.items : []) {
    const q = locate(docs, d)
    if (!q) reject('documents', d.item, 'the quote is not on any gathered document', d)
    else if (!len(d.item, 3, 120)) reject('documents', d.item, 'a document is 3 to 120 characters', d)
    else if (!facts.documents.some((x) => comparable(x.item) === comparable(d.item))) facts.documents.push({ item: d.item.trim(), q })
  }
  if (facts.documents.length > 10) {
    notes.push(`documents: ${facts.documents.length - 10} past the 10th dropped`)
    facts.documents = facts.documents.slice(0, 10)
  }

  if (w.effort.status === 'stated' && w.effort.steps.length) {
    const steps: Step[] = []
    let broken = false
    for (const s of w.effort.steps.slice(0, 5)) {
      const q = locate(docs, s)
      if (!q) {
        reject('effort', s.step, 'the quote is not on any gathered document', s)
        broken = true
        continue
      }
      if (!len(s.step, 3, 80)) {
        reject('effort', s.step, 'a step is 3 to 80 characters', s)
        broken = true
        continue
      }
      let due = s.due
      if (due !== null) {
        if (!isoDate.safeParse(due).success || Number.isNaN(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due) {
          notes.push(`effort "${s.step}": ${due} is not a calendar date; left undated`)
          due = null
        } else if (readsTwoWays(q.quote, due)) {
          flags.push({ field: 'effort', item: s.step, why: `${due} is written so it reads two ways (day and month swapped)`, quote: q.quote, doc: q.doc, source: 'verify' })
          due = null
        } else if (!statesDate(q.quote, due)) {
          notes.push(`effort "${s.step}": the quote does not state ${due} whole; left undated`)
          due = null
        }
      }
      steps.push({ step: s.step.trim(), due, q })
    }
    if (w.effort.steps.length > 5) notes.push('effort: steps past the 5th dropped')
    const dated = steps.map((s) => s.due).filter((d): d is string => d !== null)
    if (dated.some((d, i) => i > 0 && d < dated[i - 1]!)) {
      flags.push({ field: 'effort', item: 'due dates', why: 'steps are not due in order', source: 'verify' })
      for (const s of steps) s.due = null
    }
    // A step list with a hole is not the funder's list: the whole field goes to the strong model.
    if (steps.length && !broken) facts.effort = { steps, more_after: w.effort.more_after }
  }

  const cf = w.co_finance
  if (cf.status === 'stated' && cf.required !== null) {
    const q = locate(docs, cf)
    if (!q) reject('co_finance', `required: ${cf.required}`, 'the quote is not on any gathered document', cf)
    else {
      facts.co_finance_required = { value: cf.required, q }
      if (cf.required) {
        const dq = (cf.detail_quote && locate(docs, { doc: cf.detail_doc, quote: cf.detail_quote })) || q
        const c: CoFinance = { q: dq }
        const nums = numbersIn(dq.quote)
        if (cf.min_share !== null && cf.ratio === null) {
          if (cf.min_share > 0 && cf.min_share <= 100 && (nums.has(cf.min_share) || nums.has(cf.min_share / 100))) c.min_share = cf.min_share
          else notes.push(`co_finance: share ${cf.min_share}% dropped, its quote does not state it`)
        }
        if (cf.ratio !== null) {
          const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(cf.ratio.replace(/\s/g, ''))
          if (m && Number(m[1]) > 0 && Number(m[2]) > 0 && (comparable(dq.quote).replace(/\s/g, '').includes(`${m[1]}:${m[2]}`) || (nums.has(Number(m[1])) && nums.has(Number(m[2]))))) c.ratio = `${m[1]}:${m[2]}`
          else notes.push(`co_finance: ratio ${cf.ratio} dropped, its quote does not state it`)
        }
        if (cf.min_amount) {
          if (cf.min_amount.value > 0 && /^[A-Z]{3}$/.test(cf.min_amount.currency) && nums.has(cf.min_amount.value) && statesCurrency(dq.quote, cf.min_amount.currency)) c.min_amount = cf.min_amount
          else notes.push(`co_finance: fixed sum dropped, its quote does not state ${cf.min_amount.value} ${cf.min_amount.currency}`)
        }
        if (cf.in_kind === true) c.in_kind = true
        if (cf.applies_to && len(cf.applies_to, 5, 80)) c.applies_to = cf.applies_to.trim()
        if (c.min_share !== undefined || c.ratio || c.min_amount || c.in_kind) facts.co_finance = c
      }
    }
  }

  const con = w.consortium
  if (con.status === 'stated' && con.required !== null) {
    const q = locate(docs, con)
    if (!q) reject('consortium', `required: ${con.required}`, 'the quote is not on any gathered document', con)
    else facts.consortium_required = { value: con.required, q }
  }

  for (const a of w.after_award.status === 'stated' ? w.after_award.items : []) {
    const q = locate(docs, a)
    if (!q) {
      reject('after_award', a.duty, 'the quote is not on any gathered document', a)
      continue
    }
    if (facts.after_award.some((x) => x.duty === a.duty)) continue
    const d: Duty = { duty: a.duty, q }
    if (a.duty === 'reports') d.reports = a.reports ?? 'unspecified'
    facts.after_award.push(d)
  }

  return { facts, flags, notes }
}

/** The ≤400-character passage of a document that holds all these quotes, if they sit that close; else null. */
export function span(doc: Doc, quotes: string[]): string | null {
  const page = comparable(doc.text)
  if (page.length !== doc.text.length) return null
  let lo = Infinity
  let hi = -1
  for (const q of quotes) {
    const at = page.indexOf(comparable(q))
    if (at < 0) return null
    lo = Math.min(lo, at)
    hi = Math.max(hi, at + comparable(q).length)
  }
  return hi - lo <= 400 ? doc.text.slice(lo, hi) : null
}

/** Up to `max` quotes that together state every item: neighbouring quotes on one document are joined into one passage. */
export function packQuotes(docs: Doc[], quotes: Quote[], max: number): { packed: Quote[]; covers: number[][] } | null {
  const groups: { q: Quote; members: number[] }[] = quotes.map((q, i) => ({ q, members: [i] }))
  const docOf = new Map(docs.map((d) => [d.ref, d]))
  // Same quote twice is one quote.
  for (let i = 0; i < groups.length; i++)
    for (let j = groups.length - 1; j > i; j--)
      if (groups[i]!.q.doc === groups[j]!.q.doc && comparable(groups[i]!.q.quote) === comparable(groups[j]!.q.quote)) {
        groups[i]!.members.push(...groups[j]!.members)
        groups.splice(j, 1)
      }
  let merged = true
  while (groups.length > max && merged) {
    merged = false
    outer: for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        if (groups[i]!.q.doc !== groups[j]!.q.doc) continue
        const doc = docOf.get(groups[i]!.q.doc)
        const joined = doc && span(doc, [groups[i]!.q.quote, groups[j]!.q.quote])
        if (!joined) continue
        groups[i] = { q: { doc: groups[i]!.q.doc, quote: joined }, members: [...groups[i]!.members, ...groups[j]!.members] }
        groups.splice(j, 1)
        merged = true
        break outer
      }
  }
  return groups.length <= max ? { packed: groups.map((g) => g.q), covers: groups.map((g) => g.members) } : null
}

const words = (s: string) => new Set(comparable(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2))
/** Two quotes state the same thing when one contains the other or most of the shorter one's words are shared. */
export function sameQuote(a: string, b: string) {
  const x = comparable(a)
  const y = comparable(b)
  if (x.includes(y) || y.includes(x)) return true
  const wa = words(a)
  const wb = words(b)
  const shared = [...wa].filter((w) => wb.has(w)).length
  return shared / Math.max(1, Math.min(wa.size, wb.size)) >= 0.6
}

/** Two names for one item ("Audited accounts", "Latest audited accounts"): most of the shorter one's words are in the other. */
export function sameItem(a: string, b: string): boolean {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return comparable(a) === comparable(b)
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / Math.min(x.size, y.size) >= 0.5
}
