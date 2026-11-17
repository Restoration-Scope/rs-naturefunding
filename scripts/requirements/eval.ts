/**
 * Scores a run against the gold set in tests/fixtures/requirements/:
 * document-discovery recall, omitted requirements, false requirements_checked stamps, item precision,
 * typed-value and yes/no accuracy, each Jev threshold's precision and recall, and the cost per programme.
 *
 *   bun scripts/requirements/eval.ts <run folder> [--split held|tune|all] [--ids a,b]   (--ids: only these programmes)
 *
 * Items pair one to one, by quote and name (or by a quote that points at only one item on each side), and
 * only what was written to the file counts: what a visitor would see.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { comparable } from '../../src/data/text'
import type { Judgement } from './check'
import type { Field } from './extract'
import type { Result } from './pipeline'
import { sameItem, sameQuote } from './verify'
import type { Manifest, WrittenItem } from './write'

export type GoldItem = { quote: string; /** The same requirement stated elsewhere (page and PDF). */ alt_quotes?: string[]; rule?: string; kind?: string; item?: string; step?: string; due?: string | null; min_years?: number; revenue?: Record<string, unknown>; request_cap?: Record<string, unknown> }
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
  co_finance_required: { value: boolean; quote: string; alt_quotes?: string[] } | null
  co_finance: { min_share?: number; ratio?: string; min_amount?: { value: number; currency: string }; in_kind?: true } | null
  consortium_required: { value: boolean; quote: string; alt_quotes?: string[] } | null
  after_award: { duty: string; reports?: string; quote: string; alt_quotes?: string[] }[]
  notes: string
}

const FIXTURES = join('tests', 'fixtures', 'requirements')
/** One address however it is written: scheme, www, fragment and a trailing slash don't matter; the query does (editions). */
const sameUrl = (a: string, b: string) => {
  const n = (u: string) => decodeURIComponent(u).replace(/^https?:\/\/(www\.)?/, '').replace(/#.*$/, '').replace(/\/(?=$|\?)/, '').toLowerCase()
  return n(a) === n(b)
}

type G = { quote: string; alt_quotes?: string[] }
const hits = (g: G, quote: string) => [g.quote, ...(g.alt_quotes ?? [])].some((q) => sameQuote(q, quote))

/** What a result file holds: the run's result, its manifest, and the facts as written to the file. */
export type Scored = Result & { manifest: Manifest; written_items?: Partial<Record<Field, WrittenItem[]>>; co_finance_written?: Gold['co_finance'] }
type Item = { name: string; quote: string }

/**
 * Gold items to made items, one to one. A pair needs the quote and the name to agree; a quote alone pairs only
 * when it points at one gold item and one made item, so one made item can't stand for two requirements.
 */
export function pair(gold: (G & { name?: string })[], made: Item[]): Map<number, number> {
  const out = new Map<number, number>()
  const usedMade = new Set<number>()
  gold.forEach((g, gi) => {
    const mi = made.findIndex((m, i) => !usedMade.has(i) && hits(g, m.quote) && (g.name === undefined || sameItem(g.name, m.name)))
    if (mi >= 0) {
      out.set(gi, mi)
      usedMade.add(mi)
    }
  })
  gold.forEach((g, gi) => {
    if (out.has(gi)) return
    const cands = made.map((m, i) => ({ m, i })).filter(({ m, i }) => !usedMade.has(i) && hits(g, m.quote))
    if (cands.length !== 1) return
    const golds = gold.filter((x, xi) => !out.has(xi) && hits(x, cands[0]!.m.quote))
    if (golds.length !== 1) return
    out.set(gi, cands[0]!.i)
    usedMade.add(cands[0]!.i)
  })
  return out
}

type Counts = { gold: number; found: number; made: number; right: number }
const zero = (): Counts => ({ gold: 0, found: 0, made: 0, right: 0 })
const FIELD_LIST: Field[] = ['eligibility', 'documents', 'effort', 'co_finance', 'consortium', 'after_award']

const goldItems = (g: Gold): Record<Field, (G & { name?: string; gi: GoldItem | Gold['after_award'][number] | { value: boolean } })[]> => ({
  eligibility: g.eligibility.map((x) => ({ ...x, name: x.rule, gi: x })),
  documents: g.documents.map((x) => ({ ...x, name: x.item, gi: x })),
  effort: g.effort.map((x) => ({ ...x, name: x.step, gi: x })),
  co_finance: g.co_finance_required ? [{ ...g.co_finance_required, gi: g.co_finance_required }] : [],
  consortium: g.consortium_required ? [{ ...g.consortium_required, gi: g.consortium_required }] : [],
  after_award: g.after_award.map((x) => ({ ...x, name: x.duty, gi: x })),
})

const typedOf = (x: { min_years?: unknown; revenue?: unknown; request_cap?: unknown }) => {
  const t = { ...(x.min_years !== undefined ? { min_years: x.min_years } : {}), ...(x.revenue ? { revenue: x.revenue } : {}), ...(x.request_cap ? { request_cap: x.request_cap } : {}) }
  return Object.keys(t).length ? t : undefined
}
/** Same JSON whatever the key order. */
const canon = (v: unknown): string => (v && typeof v === 'object' && !Array.isArray(v) ? `{${Object.keys(v).sort().map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v ?? null))

/** `ids`: every gold programme the run was asked for; one with no result counts as a failed read. */
export function evaluate(results: Scored[], golds: Map<string, Gold>, usd: Record<string, number>) {
  const fields: Record<Field, Counts> = { eligibility: zero(), documents: zero(), effort: zero(), co_finance: zero(), consortium: zero(), after_award: zero() }
  let docsExpected = 0
  let docsFound = 0
  const missedDocs: string[] = []
  const falseStamps: { id: string; why: string }[] = []
  const omissions: { id: string; field: Field; quote: string }[] = []
  const values = { right: 0, wrong: 0 }
  const typed = { right: 0, total: 0 }
  const yesNo = { right: 0, wrong: 0, missing: 0 }
  const valueMiss: string[] = []
  const unresolvedFields: string[] = []
  const judged: { j: Judgement; wrong: boolean }[] = []
  const byId = new Map(results.map((r) => [r.id, r]))
  const failed: string[] = []
  /** Items written for a stamped programme that the gold set doesn't list. */
  const stampedExtras: { id: string; n: number }[] = []
  let rightStamps = 0
  /** Jev judgements whose fact can't be found, or whose gold property isn't stated: neither counts for thresholds. */
  const jevUnlabelled: string[] = []
  let jevUnscored = 0

  for (const [id, g] of golds) {
    const r = byId.get(id)
    const gold = goldItems(g)
    if (!r) {
      failed.push(id)
      docsExpected += g.documents_expected.length
      for (const e of g.documents_expected) missedDocs.push(`${id}: ${e.url} (no result)`)
      for (const field of FIELD_LIST) {
        fields[field].gold += gold[field].length
        for (const gi of gold[field]) omissions.push({ id, field, quote: gi.quote.slice(0, 160) })
      }
      continue
    }
    const urls = r.gathered.docs.flatMap((d) => [d.url, d.final_url])
    let missedHere = 0
    for (const e of g.documents_expected) {
      docsExpected++
      if (urls.some((u) => sameUrl(u, e.url))) docsFound++
      else {
        missedDocs.push(`${id}: ${e.url}`)
        missedHere++
      }
    }
    for (const k of FIELD_LIST) if (r.manifest.outcomes[k] === 'unresolved') unresolvedFields.push(`${id}: ${k}`)

    // What visitors would see: the items written to the file.
    const written = r.written_items ?? {}
    let missed = 0
    let extra = 0
    const missBefore = valueMiss.length
    for (const field of FIELD_LIST) {
      const made = written[field] ?? []
      const pairs = pair(gold[field], made)
      const c = fields[field]
      c.gold += gold[field].length
      c.found += pairs.size
      c.made += made.length
      c.right += pairs.size
      extra += made.length - pairs.size
      gold[field].forEach((gi, i) => {
        if (pairs.has(i)) return
        omissions.push({ id, field, quote: gi.quote.slice(0, 160) })
        missed++
      })
      for (const [gIdx, mIdx] of pairs) {
        const gi = gold[field][gIdx]!.gi as GoldItem & { value?: boolean; reports?: string }
        const m = made[mIdx]!
        if (field === 'eligibility') {
          if (gi.kind && m.kind !== gi.kind) {
            values.wrong++
            valueMiss.push(`${id}: kind ${m.kind} for "${gi.rule}", gold ${gi.kind}`)
          } else if (gi.kind) values.right++
          const want = typedOf(gi)
          if (want || m.typed) {
            typed.total++
            if (canon(want) === canon(m.typed)) typed.right++
            else valueMiss.push(`${id}: typed ${canon(m.typed)} for "${gi.rule}", gold ${canon(want)}`)
          }
        }
        if (field === 'effort' && gi.due !== undefined) {
          if ((gi.due ?? null) === (m.due ?? null)) values.right++
          else {
            values.wrong++
            valueMiss.push(`${id}: "${m.name}" due ${m.due}, gold ${gi.due}`)
          }
        }
        if (field === 'co_finance' || field === 'consortium' || (field === 'after_award' && gi.reports)) {
          const want = field === 'after_award' ? gi.reports : gi.value
          if (m.value === want) yesNo.right++
          else {
            yesNo.wrong++
            valueMiss.push(`${id}: ${field} ${m.value}, gold ${want}`)
          }
        }
      }
      // A yes/no the gold set states and the file doesn't.
      if ((field === 'co_finance' || field === 'consortium') && gold[field].length && !pairs.size) yesNo.missing++
    }
    if (g.co_finance || r.co_finance_written) {
      for (const k of ['min_share', 'ratio', 'min_amount', 'in_kind'] as const) {
        const want = g.co_finance?.[k]
        const got = r.co_finance_written?.[k]
        if (want === undefined && got === undefined) continue
        if (canon(want) === canon(got)) values.right++
        else {
          values.wrong++
          valueMiss.push(`${id}: co_finance.${k} ${canon(got)}, gold ${canon(want)}`)
        }
      }
    }
    if (r.manifest.requirements_checked) {
      const wrongHere = valueMiss.length - missBefore
      const why = [
        ...(!g.coverage_complete ? ['the gold set says a full read is not possible from these pages'] : []),
        ...(missedHere ? [`${missedHere} documents the gold set expects were not opened`] : []),
        ...(missed ? [`${missed} requirements the gold set lists were not written`] : []),
        ...(wrongHere ? [`${wrongHere} written values differ from the gold set`] : []),
      ]
      if (why.length) falseStamps.push({ id, why: why.join('; ') })
      else rightStamps++
      if (extra) stampedExtras.push({ id, n: extra })
    }

    // Jev's judgements, each labelled against the gold property it is about.
    // The items Jev judged on the first reading, by their own name and quote: an escalation may have
    // replaced them in the final facts, and their judgements still count.
    const judgedItems = Object.fromEntries(FIELD_LIST.map((f) => [f, [] as Item[]])) as Record<Field, Item[]>
    for (const j of r.judgements) {
      if (j.question.endsWith('@strong') || j.question === 'omission' || j.question === 'co_finance' || !j.quote) continue
      const list = judgedItems[j.field]
      if (!list.some((m) => m.name === j.item && m.quote === j.quote)) list.push({ name: j.item, quote: j.quote })
    }
    const fp = Object.fromEntries(FIELD_LIST.map((f) => [f, pair(gold[f], judgedItems[f])])) as Record<Field, Map<number, number>>
    const goldOf = (field: Field, j: Judgement) => {
      const mi = judgedItems[field].findIndex((m) => m.name === j.item && m.quote === j.quote)
      if (mi < 0) return { found: false as const }
      const gIdx = [...fp[field]].find(([, m]) => m === mi)?.[0]
      return gIdx === undefined ? { found: true as const, gold: null } : { found: true as const, gold: gold[field][gIdx]!.gi as GoldItem & { value?: boolean; reports?: string; duty?: string } }
    }
    const omit = new Map<Field, number>()
    for (const j of r.judgements) {
      if (j.question.endsWith('@strong')) continue
      if (j.question === 'omission') {
        omit.set(j.field, Math.max(omit.get(j.field) ?? 0, j.p))
        continue
      }
      if (j.field === 'co_finance' && j.question === 'co_finance') {
        judged.push({ j, wrong: canon(g.co_finance?.[j.item as 'min_share']) !== (j.expected ?? 'null') })
        continue
      }
      const at = goldOf(j.field, j)
      if (!at.found) {
        jevUnlabelled.push(`${id}: ${j.field}/${j.question} "${j.item}"`)
        continue
      }
      const gi = at.gold
      let wrong: boolean | null
      switch (j.question) {
        case 'kind':
          wrong = gi?.kind ? gi.kind !== j.expected : null
          break
        case 'typed':
          wrong = gi ? canon(typedOf(gi)) !== canon(j.expected ? JSON.parse(j.expected) : undefined) : true
          break
        case 'due':
          wrong = gi ? (gi.due === undefined ? null : String(gi.due ?? null) !== String(j.expected ?? null)) : true
          break
        case 'required':
          wrong = gi ? String(gi.value) !== j.expected : true
          break
        case 'reports':
          wrong = gi?.reports ? gi.reports !== j.expected : gi ? null : true
          break
        default:
          // Is this item a real requirement at all (selection, overreach, polarity, first step, step, duty)?
          wrong = !gi
      }
      if (wrong !== null) judged.push({ j, wrong })
      else jevUnscored++
    }
    // One omission judgment per programme and field: the highest over its chunks, against whether the gold set lists
    // items the first reading missed (a thin field may already hold one).
    for (const [field, p] of omit) judged.push({ j: { field, item: field, question: 'omission', p }, wrong: gold[field].length > fp[field].size })
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
  const stamped = scored.filter((r) => r.manifest.requirements_checked).length
  const stampable = [...golds.values()].filter((g) => g.coverage_complete).length
  const sum = (k: keyof Counts) => Object.values(fields).reduce((a, c) => a + c[k], 0)
  return {
    programmes: golds.size,
    failed,
    discovery_recall: pct(docsFound, docsExpected),
    missed_documents: missedDocs,
    item_recall: Object.fromEntries(Object.entries(fields).map(([k, c]) => [k, pct(c.found, c.gold)])),
    item_precision: Object.fromEntries(Object.entries(fields).map(([k, c]) => [k, pct(c.right, c.made)])),
    all_items: { recall: pct(sum('found'), sum('gold')), precision: pct(sum('right'), sum('made')) },
    omissions,
    stamped,
    /** Right stamps out of the gold programmes a full read is possible for: a pipeline that never stamps has no false stamps. */
    stamp_yield: { right: rightStamps, of: stampable, pct: pct(rightStamps, stampable) },
    false_stamps: falseStamps,
    /** With 0 false stamps out of n, the rate is below about 3/n at 95% (rule of three). */
    false_stamp_bound: stamped ? (falseStamps.length ? null : Math.round((3 / stamped) * 1000) / 10) : null,
    stamped_extras: stampedExtras,
    jev_unlabelled: jevUnlabelled,
    jev_unscored: jevUnscored,
    typed_values: typed,
    values,
    value_misses: valueMiss,
    unresolved: { fields: unresolvedFields.length, of: scored.length * 6, list: unresolvedFields },
    yes_no: yesNo,
    jev: thresholds,
    usd: { total: Math.round(costs.reduce((a, b) => a + b, 0) * 1000) / 1000, per_programme_mean: costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 10000) / 10000 : 0, per_programme_max: Math.round(Math.max(0, ...costs) * 10000) / 10000 },
  }
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { split: { type: 'string', default: 'held' }, ids: { type: 'string' } } })
  const dir = positionals[0]
  if (!dir) throw new Error('usage: eval.ts <run folder> [--split held|tune|all]')
  const index = JSON.parse(readFileSync(join(FIXTURES, 'index.json'), 'utf8')) as { programmes: { id: string; split: string }[] }
  const only = values.ids ? new Set(values.ids.split(',')) : null
  const ids = new Set(index.programmes.filter((p) => (values.split === 'all' || p.split === values.split) && (!only || only.has(p.id))).map((p) => p.id))
  const golds = new Map<string, Gold>()
  // A gold id with no fixture yet can't be scored; it is listed, not counted.
  const noFixture = [...ids].filter((id) => !existsSync(join(FIXTURES, `${id}.json`)))
  for (const id of ids) if (!noFixture.includes(id)) golds.set(id, JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), 'utf8')))
  const results = readdirSync(join(dir, 'results'))
    .map((f) => JSON.parse(readFileSync(join(dir, 'results', f), 'utf8')) as Scored)
    .filter((r) => ids.has(r.id))
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as { summary: { id: string; usd: number }[] }
  const usd = Object.fromEntries(report.summary.map((s) => [s.id, s.usd]))
  const e = { ...evaluate(results, golds, usd), no_fixture: noFixture }
  writeFileSync(join(dir, `eval-${values.split}${only ? '-ids' : ''}.json`), JSON.stringify(e, null, 2))
  console.log(JSON.stringify({ ...e, no_fixture: noFixture.length }, null, 2))
}
