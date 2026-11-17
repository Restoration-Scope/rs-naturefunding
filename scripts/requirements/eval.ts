/**
 * Scores a run against the gold set in tests/fixtures/requirements/:
 * document-discovery recall, omitted requirements, false requirements_checked stamps, item precision,
 * typed-value and yes/no accuracy, each Jev threshold's precision and recall, and the cost per programme.
 *
 *   bun scripts/requirements/eval.ts <run folder> [--split held|tune|all]
 *
 * Items match by their quotes (one contains the other, or most of their words are shared), so wording of
 * our own text doesn't count against the reader.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { comparable } from '../../src/data/text'
import type { Judgement } from './check'
import type { Field } from './extract'
import type { Result } from './pipeline'
import type { Manifest } from './write'

export type GoldItem = { quote: string; rule?: string; kind?: string; item?: string; step?: string; due?: string | null; min_years?: number; revenue?: Record<string, unknown>; request_cap?: Record<string, unknown> }
export type Gold = {
  id: string
  filled_by: string
  checked_by_person: boolean
  /** Pages and documents that state the programme's requirements; the crawl should open each. */
  documents_expected: { url: string; why: string }[]
  /** Whether a full read is possible from machine-readable text; false when a needed page needs a browser or OCR. */
  coverage_complete: boolean
  eligibility: GoldItem[]
  documents: GoldItem[]
  effort: GoldItem[]
  co_finance_required: { value: boolean; quote: string } | null
  co_finance: { min_share?: number; ratio?: string; min_amount?: { value: number; currency: string }; in_kind?: true } | null
  consortium_required: { value: boolean; quote: string } | null
  after_award: { duty: string; reports?: string; quote: string }[]
  notes: string
}

const FIXTURES = join('tests', 'fixtures', 'requirements')
const words = (s: string) => new Set(comparable(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2))
export function sameQuote(a: string, b: string) {
  const x = comparable(a)
  const y = comparable(b)
  if (x.includes(y) || y.includes(x)) return true
  const wa = words(a)
  const wb = words(b)
  const shared = [...wa].filter((w) => wb.has(w)).length
  return shared / Math.min(wa.size, wb.size || 1) >= 0.6
}
const sameUrl = (a: string, b: string) => {
  const n = (u: string) => decodeURIComponent(u).replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase()
  return n(a) === n(b)
}

type Counts = { gold: number; found: number; made: number; right: number }
const zero = (): Counts => ({ gold: 0, found: 0, made: 0, right: 0 })

/** Per field: gold items found (recall), and pipeline items that match a gold item (precision). */
function scoreItems(gold: GoldItem[] | { quote: string }[], made: { quote: string }[], c: Counts) {
  c.gold += gold.length
  c.found += gold.filter((g) => made.some((m) => sameQuote(m.quote, g.quote))).length
  c.made += made.length
  c.right += made.filter((m) => gold.some((g) => sameQuote(m.quote, g.quote))).length
}

export function evaluate(results: (Result & { manifest: Manifest })[], golds: Map<string, Gold>, usd: Record<string, number>) {
  const fields: Record<Field, Counts> = { eligibility: zero(), documents: zero(), effort: zero(), co_finance: zero(), consortium: zero(), after_award: zero() }
  let docsExpected = 0
  let docsFound = 0
  const missedDocs: string[] = []
  const falseStamps: { id: string; why: string }[] = []
  const omissions: { id: string; field: Field; quote: string }[] = []
  let typedRight = 0
  let typedTotal = 0
  const yesNo = { right: 0, wrong: 0, missing: 0 }
  const judged: { j: Judgement; wrong: boolean }[] = []

  for (const r of results) {
    const g = golds.get(r.id)
    if (!g) continue
    const urls = r.gathered.docs.flatMap((d) => [d.url, d.final_url])
    for (const e of g.documents_expected) {
      docsExpected++
      if (urls.some((u) => sameUrl(u, e.url))) docsFound++
      else missedDocs.push(`${r.id}: ${e.url}`)
    }
    const f = r.facts
    const made: Record<Field, { quote: string }[]> = {
      eligibility: f.eligibility.map((e) => ({ quote: e.q.quote })),
      documents: f.documents.map((d) => ({ quote: d.q.quote })),
      effort: f.effort?.steps.map((s) => ({ quote: s.q.quote })) ?? [],
      co_finance: f.co_finance_required ? [{ quote: f.co_finance_required.q.quote }] : [],
      consortium: f.consortium_required ? [{ quote: f.consortium_required.q.quote }] : [],
      after_award: f.after_award.map((a) => ({ quote: a.q.quote })),
    }
    const goldBy: Record<Field, { quote: string }[]> = {
      eligibility: g.eligibility,
      documents: g.documents,
      effort: g.effort,
      co_finance: g.co_finance_required ? [g.co_finance_required] : [],
      consortium: g.consortium_required ? [g.consortium_required] : [],
      after_award: g.after_award,
    }
    let missed = 0
    for (const field of Object.keys(fields) as Field[]) {
      // Documents and steps often sit in one passage: an item counts as found when its quote's passage was quoted.
      scoreItems(goldBy[field], made[field], fields[field])
      for (const gi of goldBy[field]) if (!made[field].some((m) => sameQuote(m.quote, gi.quote))) {
        omissions.push({ id: r.id, field, quote: gi.quote.slice(0, 160) })
        missed++
      }
    }
    for (const e of f.eligibility) {
      const gi = g.eligibility.find((x) => sameQuote(x.quote, e.q.quote))
      if (!gi) continue
      for (const k of ['min_years', 'revenue', 'request_cap'] as const) {
        if (gi[k] === undefined && e[k] === undefined) continue
        typedTotal++
        if (JSON.stringify(gi[k]) === JSON.stringify(e[k])) typedRight++
      }
    }
    for (const [mine, theirs] of [
      [f.co_finance_required?.value, g.co_finance_required?.value],
      [f.consortium_required?.value, g.consortium_required?.value],
      [f.after_award.find((a) => a.duty === 'reports')?.reports, g.after_award.find((a) => a.duty === 'reports')?.reports],
    ] as const) {
      if (theirs === undefined) continue
      if (mine === undefined) yesNo.missing++
      else if (mine === theirs) yesNo.right++
      else yesNo.wrong++
    }
    if (r.manifest.requirements_checked) {
      if (!g.coverage_complete) falseStamps.push({ id: r.id, why: 'the gold set says a full read needs a browser or OCR' })
      else if (missed) falseStamps.push({ id: r.id, why: `${missed} requirements the gold set lists were not read` })
    }
    for (const j of r.judgements) {
      if (j.question.endsWith('@strong')) continue
      if (j.question === 'omission') judged.push({ j, wrong: goldBy[j.field].length > 0 })
      else if (j.quote) judged.push({ j, wrong: !goldBy[j.field].some((gi) => sameQuote(gi.quote, j.quote!)) })
    }
  }

  // Each Jev question as a detector of wrong items (or of a field the text states, for omission).
  const thresholds: Record<string, { n: number; positives: number; at: Record<string, { precision: number | null; recall: number | null }> }> = {}
  for (const q of [...new Set(judged.map((x) => x.j.question))]) {
    const xs = judged.filter((x) => x.j.question === q)
    const positives = xs.filter((x) => x.wrong).length
    const at: Record<string, { precision: number | null; recall: number | null }> = {}
    for (const t of [0.3, 0.5, 0.7, 0.9]) {
      const flagged = xs.filter((x) => x.j.p >= t)
      const tp = flagged.filter((x) => x.wrong).length
      at[t.toFixed(1)] = { precision: flagged.length ? tp / flagged.length : null, recall: positives ? tp / positives : null }
    }
    thresholds[q] = { n: xs.length, positives, at }
  }

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)
  const scored = results.filter((r) => golds.has(r.id))
  const costs = scored.map((r) => usd[r.id] ?? 0)
  return {
    programmes: scored.length,
    discovery_recall: pct(docsFound, docsExpected),
    missed_documents: missedDocs,
    item_recall: Object.fromEntries(Object.entries(fields).map(([k, c]) => [k, pct(c.found, c.gold)])),
    item_precision: Object.fromEntries(Object.entries(fields).map(([k, c]) => [k, pct(c.right, c.made)])),
    all_items: { recall: pct(Object.values(fields).reduce((a, c) => a + c.found, 0), Object.values(fields).reduce((a, c) => a + c.gold, 0)), precision: pct(Object.values(fields).reduce((a, c) => a + c.right, 0), Object.values(fields).reduce((a, c) => a + c.made, 0)) },
    omissions,
    stamped: scored.filter((r) => r.manifest.requirements_checked).length,
    false_stamps: falseStamps,
    typed_values: { right: typedRight, total: typedTotal },
    yes_no: yesNo,
    jev: thresholds,
    usd: { total: Math.round(costs.reduce((a, b) => a + b, 0) * 1000) / 1000, per_programme_mean: costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10000) / 10000 : 0, per_programme_max: Math.round(Math.max(0, ...costs) * 10000) / 10000 },
  }
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { split: { type: 'string', default: 'held' } } })
  const dir = positionals[0]
  if (!dir) throw new Error('usage: eval.ts <run folder> [--split held|tune|all]')
  const index = JSON.parse(readFileSync(join(FIXTURES, 'index.json'), 'utf8')) as { programmes: { id: string; split: string }[] }
  const ids = new Set(index.programmes.filter((p) => values.split === 'all' || p.split === values.split).map((p) => p.id))
  const golds = new Map<string, Gold>()
  for (const id of ids) if (existsSync(join(FIXTURES, `${id}.json`))) golds.set(id, JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8')))
  const results = readdirSync(join(dir, 'results'))
    .map((f) => JSON.parse(readFileSync(join(dir, 'results', f), 'utf8')) as Result & { manifest: Manifest })
    .filter((r) => ids.has(r.id))
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as { summary: { id: string; usd: number }[] }
  const usd = Object.fromEntries(report.summary.map((s) => [s.id, s.usd]))
  const e = evaluate(results, golds, usd)
  writeFileSync(join(dir, `eval-${values.split}.json`), JSON.stringify(e, null, 2))
  console.log(JSON.stringify({ ...e, omissions: e.omissions.length, missed_documents: e.missed_documents.length }, null, 2))
}
