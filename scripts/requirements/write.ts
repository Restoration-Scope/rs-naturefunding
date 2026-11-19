/**
 * Stage 7, write: verified facts go into the programme file surgically, one field at a time, each held to
 * the full schema; a field that breaks it is reverted and left unresolved. A reading that disagrees with a
 * value already in the file keeps the old value and leaves the field unresolved for a person.
 * `requirements_checked` is set only when coverage is complete and no field is partial or unresolved. The coverage
 * manifest goes to data/requirements/<id>.json: documents, hashes, chunks, outcomes and cost, no page text.
 */
import { programme as programmeSchema, type Evidence, type Programme, type Source } from '../../src/data/schema'
import { comparable } from '../../src/data/text'
import { formatJson } from '../refresh/json'
import type { Field } from './extract'
import { FIELDS, PROMPT_VERSION } from './extract'
import type { Doc } from './gather'
import type { Outcome, Result } from './pipeline'
import { packQuotes, sameItem, sameQuote, type Quote } from './verify'

export type Manifest = {
  id: string
  read_on: string
  prompt_version: string
  models: string[]
  complete: boolean
  reasons: string[]
  requirements_checked: boolean
  documents: { ref: string; url: string; final_url: string; from: string | null; anchor: string | null; depth: number; pdf: boolean; chars: number; pages: number | null; low_text: boolean; hash: string }[]
  failures: Result['gathered']['failures']
  skipped_links: number
  chunks: Result['chunks']
  outcomes: Record<Field, Outcome>
  written: Field[]
  escalated: Field[]
  flags: { field: Field; item: string; why: string }[]
  notes: string[]
  usd: number
}

const FIELD_KEYS: Record<Field, (keyof Programme)[]> = {
  eligibility: ['eligibility'],
  documents: ['documents'],
  effort: ['effort'],
  co_finance: ['co_finance_required', 'co_finance'],
  consortium: ['consortium_required'],
  after_award: ['after_award'],
}

type Draft = Programme & Record<string, unknown>

/** One fact as written to the file, with its own quote: what eval scores. */
export type WrittenItem = { name: string; quote: string; kind?: string; due?: string | null; typed?: Record<string, unknown>; value?: boolean | string }

/** Old items with no counterpart among the new ones, matched one to one so two old items can't share one new item. */
function unmatched<O, N>(old: O[], now: N[], same: (o: O, n: N) => boolean): O[] {
  const free = [...now]
  return old.filter((o) => {
    const i = free.findIndex((n) => same(o, n))
    if (i < 0) return true
    free.splice(i, 1)
    return false
  })
}

export function apply(
  p: Programme,
  r: Result,
  today: string,
  sources: Source[],
): { next: Programme; manifestBits: Pick<Manifest, 'outcomes' | 'written' | 'notes' | 'requirements_checked'>; sources: Source[]; items: Partial<Record<Field, WrittenItem[]>> } {
  const docs = new Map(r.gathered.docs.map((d) => [d.ref, d]))
  const outcomes = { ...r.outcomes }
  const notes: string[] = []
  const written: Field[] = []
  const ev = (q: Quote): Evidence => ({ source_url: docs.get(q.doc)!.url, quote: q.quote, checked_at: today, method: 'page' })
  const packed = (qs: Quote[], max: number) => packQuotes(r.gathered.docs, qs, max)
  let cur: Draft = structuredClone(p) as Draft
  const used: Quote[] = []
  let docsKept = r.facts.documents

  const tryField = (field: Field, edit: (d: Draft) => Quote[] | null) => {
    const draft = structuredClone(cur)
    const quotes = edit(draft)
    if (!quotes) return
    const ok = programmeSchema.safeParse(draft)
    if (!ok.success) {
      outcomes[field] = 'unresolved'
      notes.push(`${field}: not written, the schema refuses it: ${ok.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 300)}`)
      return
    }
    cur = draft
    used.push(...quotes)
    written.push(field)
  }

  /** What a new reading would lose from the file: a quoted fact, an item, a due date, a typed value or a duty. Items are
   * compared one by one, not by quote: two documents named in one passage are two facts. */
  const losses = (field: Field, newQuotes: string[]): string[] => {
    const f = r.facts
    const keys = FIELD_KEYS[field].filter((k) => k !== 'co_finance_required' && k !== 'consortium_required')
    const oldQuotes = keys.flatMap((k) => [cur.evidence[k as keyof Programme['evidence']]].flat().filter(Boolean).map((e) => (e as Evidence).quote))
    const out = oldQuotes.filter((o) => !newQuotes.some((n) => sameQuote(n, o))).map((o) => `the file quotes "${o.slice(0, 80)}", this reading does not`)
    if (field === 'effort') {
      for (const d of cur.effort?.due ?? []) if (d && !f.effort?.steps.some((s) => s.due === d)) out.push(`the file dates a step ${d}, this reading does not`)
      for (const s of unmatched(cur.effort?.steps ?? [], f.effort?.steps ?? [], (o, n) => sameItem(o, n.step))) out.push(`the file lists the step "${s}", this reading does not`)
    }
    if (field === 'documents') for (const d of unmatched(cur.documents ?? [], f.documents, (o, n) => sameItem(o, n.item))) out.push(`the file lists "${d}", this reading does not`)
    if (field === 'co_finance' && cur.co_finance && f.co_finance)
      for (const [k, v] of Object.entries(cur.co_finance)) if (JSON.stringify(v) !== JSON.stringify((f.co_finance as Record<string, unknown>)[k])) out.push(`the file gives co_finance.${k} ${JSON.stringify(v)}, this reading does not`)
    if (field === 'eligibility') {
      const old = (cur.eligibility ?? []).map((e, i) => ({ e, q: cur.evidence.eligibility?.[i]?.quote ?? '' }))
      // A rule rephrased on its own quote is the same rule; two rules on one quote must each find their own.
      const alone = (q: string) => old.filter((x) => sameQuote(x.q, q)).length === 1
      for (const { e } of unmatched(old, f.eligibility, (o, n) => sameQuote(n.q.quote, o.q) && (alone(o.q) || sameItem(o.e.rule, n.rule)))) out.push(`the file has the rule "${e.rule}", this reading does not`)
      for (const { e, q } of old) {
        const now = f.eligibility.find((x) => sameQuote(x.q.quote, q) && (alone(q) || sameItem(e.rule, x.rule)))
        for (const k of ['min_years', 'revenue', 'request_cap'] as const) if (e[k] !== undefined && JSON.stringify(e[k]) !== JSON.stringify(now?.[k])) out.push(`the file gives "${e.rule}" a ${k}, this reading does not`)
      }
    }
    if (field === 'after_award')
      for (const [k, v] of Object.entries(cur.after_award ?? {})) {
        const now = f.after_award.find((x) => x.duty === k)
        if (!now || (k === 'reports' && now.reports !== v)) out.push(`the file says after_award.${k} is ${v}, this reading does not`)
      }
    return out
  }
  const guard = (field: Field, quotes: Quote[]) => {
    const lost = losses(field, quotes.map((q) => q.quote))
    if (!lost.length) return true
    outcomes[field] = 'unresolved'
    notes.push(`${field}: not written, ${lost.slice(0, 3).join('; ')}`)
    return false
  }

  for (const field of FIELDS) {
    const f = r.facts
    const had = FIELD_KEYS[field].some((k) => cur[k] !== undefined && cur[k] !== null)
    if (outcomes[field] === 'unresolved') continue
    if (outcomes[field] === 'not_found') {
      // An earlier reading stated it and this one found nothing: a person decides.
      if (had && field !== 'co_finance') {
        outcomes[field] = 'unresolved'
        notes.push(`${field}: the file states it, this reading found nothing`)
      }
      if (field === 'co_finance' && cur.co_finance_required !== null) {
        outcomes[field] = 'unresolved'
        notes.push('co_finance: the file states whether co-funding is required, this reading found nothing')
      }
      continue
    }

    if (field === 'co_finance') {
      const req = f.co_finance_required!
      if (cur.co_finance_required !== null && cur.co_finance_required !== req.value) {
        outcomes[field] = 'unresolved'
        notes.push(`co_finance: the file says required ${cur.co_finance_required}, this reading says ${req.value}`)
        continue
      }
      tryField(field, (d) => {
        d.co_finance_required = req.value
        d.evidence.co_finance_required = ev(req.q)
        if (req.value && f.co_finance) {
          if (cur.co_finance && !guard(field, [f.co_finance.q])) return null
          const { q, ...rest } = f.co_finance
          d.co_finance = rest
          d.evidence.co_finance = ev(q)
          return [req.q, q]
        }
        if (!req.value) {
          delete d.co_finance
          delete d.evidence.co_finance
        }
        return [req.q]
      })
      continue
    }
    if (field === 'consortium') {
      const c = f.consortium_required!
      if (cur.consortium_required !== undefined && cur.consortium_required !== c.value) {
        outcomes[field] = 'unresolved'
        notes.push(`consortium: the file says required ${cur.consortium_required}, this reading says ${c.value}`)
        continue
      }
      tryField(field, (d) => {
        d.consortium_required = c.value
        d.evidence.consortium_required = ev(c.q)
        return [c.q]
      })
      continue
    }
    if (field === 'eligibility') {
      if (!guard(field, f.eligibility.map((e) => e.q))) continue
      tryField(field, (d) => {
        d.eligibility = f.eligibility.map(({ q: _q, ...rule }) => rule)
        d.evidence.eligibility = f.eligibility.map((e) => ev(e.q))
        return f.eligibility.map((e) => e.q)
      })
      continue
    }
    if (field === 'documents') {
      const items = f.documents
      // The fewest passages that state every item: three when the list sits together, else up to one per document.
      let pk: ReturnType<typeof packed> = null
      for (let max = 3; !pk && max <= Math.max(3, items.length); max++) pk = packed(items.map((x) => x.q), max)
      if (!pk) {
        outcomes[field] = 'unresolved'
        notes.push('documents: not written, the quotes do not fit one passage per document')
        continue
      }
      if (!guard(field, pk.packed)) continue
      docsKept = items
      tryField(field, (d) => {
        d.documents = items.map((x) => x.item)
        d.evidence.documents = pk!.packed.map(ev)
        return pk!.packed
      })
      continue
    }
    if (field === 'effort') {
      const e = f.effort!
      const pk = packed(e.steps.map((s) => s.q), 5)
      if (!pk) {
        outcomes[field] = 'unresolved'
        notes.push('effort: not written, the quotes do not fit five passages')
        continue
      }
      if (!guard(field, pk.packed)) continue
      tryField(field, (d) => {
        const due = e.steps.map((s) => s.due)
        d.effort = { steps: e.steps.map((s) => s.step), ...(e.more_after ? { more_after: true } : {}), ...(due.some(Boolean) ? { due } : {}) }
        d.evidence.effort = pk.packed.map(ev)
        return pk.packed
      })
      continue
    }
    if (field === 'after_award') {
      const pk = packed(f.after_award.map((a) => a.q), 4)
      if (!pk) {
        outcomes[field] = 'unresolved'
        notes.push('after_award: not written, the quotes do not fit four passages')
        continue
      }
      if (!guard(field, pk.packed)) continue
      tryField(field, (d) => {
        const a: NonNullable<Programme['after_award']> = {}
        for (const x of f.after_award) {
          if (x.duty === 'reports') a.reports = x.reports ?? 'unspecified'
          else a[x.duty] = true
        }
        d.after_award = a
        d.evidence.after_award = pk.packed.map(ev)
        return pk.packed
      })
    }
  }

  const unresolved = FIELDS.filter((x) => outcomes[x] === 'unresolved' || outcomes[x] === 'partial')
  let stamp = r.gathered.complete && unresolved.length === 0 && !r.error
  if (stamp) {
    const draft = structuredClone(cur)
    draft.requirements_checked = today
    if (programmeSchema.safeParse(draft).success) cur = draft
    else stamp = false
  }
  // A reading that can't vouch for the fields now takes back an earlier stamp: visitors would read an absent
  // fact as "the funder's pages don't say". The manifest keeps when it was last stamped.
  if (!stamp && cur.requirements_checked) {
    notes.push(`requirements_checked ${cur.requirements_checked} removed: this reading could not confirm every field`)
    delete cur.requirements_checked
  }

  // The refresh reads a source through its selector: a new quote outside it would look gone, so that
  // source reads the whole page instead.
  // A page newly cited joins the watch list, read whole.
  const nextSources = sources.map((s) => ({ ...s }))
  const live = p.calls.some((c) => c.status === 'open' || c.status === 'upcoming')
  for (const q of used) {
    const d = docs.get(q.doc) as Doc
    let s = nextSources.find((x) => x.programme_id === p.id && x.url === d.url)
    if (!s) {
      const n = Math.max(0, ...nextSources.filter((x) => x.programme_id === p.id).map((x) => Number(x.id.slice(p.id.length + 1)) || 0))
      s = { id: `${p.id}-${n + 1}`, programme_id: p.id, url: d.url, selector: null, hint: null, cycle: live ? 'daily' : p.access === 'direct' ? 'weekly' : 'monthly' }
      nextSources.push(s)
      notes.push(`source ${s.id}: added for ${d.url}`)
    } else if (s.selector && !(d.selected && comparable(d.selected).includes(comparable(q.quote)))) {
      notes.push(`source ${s.id}: selector ${s.selector} dropped, a new quote sits outside it`)
      s.selector = null
    }
  }

  const f = r.facts
  const items: Partial<Record<Field, WrittenItem[]>> = {}
  const typed = (e: (typeof f.eligibility)[number]) => {
    const t = { ...(e.min_years !== undefined ? { min_years: e.min_years } : {}), ...(e.revenue ? { revenue: e.revenue } : {}), ...(e.request_cap ? { request_cap: e.request_cap } : {}) }
    return Object.keys(t).length ? { typed: t } : {}
  }
  for (const field of written) {
    if (field === 'eligibility') items.eligibility = f.eligibility.map((e) => ({ name: e.rule, quote: e.q.quote, kind: e.kind, ...typed(e) }))
    if (field === 'documents') items.documents = docsKept.map((d) => ({ name: d.item, quote: d.q.quote }))
    if (field === 'effort') items.effort = (f.effort?.steps ?? []).map((s) => ({ name: s.step, quote: s.q.quote, due: s.due }))
    if (field === 'co_finance' && f.co_finance_required) items.co_finance = [{ name: 'required', quote: f.co_finance_required.q.quote, value: f.co_finance_required.value }]
    if (field === 'consortium' && f.consortium_required) items.consortium = [{ name: 'required', quote: f.consortium_required.q.quote, value: f.consortium_required.value }]
    if (field === 'after_award') items.after_award = f.after_award.map((a) => ({ name: a.duty, quote: a.q.quote, ...(a.reports ? { value: a.reports } : {}) }))
  }
  return { next: cur as Programme, manifestBits: { outcomes, written, notes, requirements_checked: stamp }, sources: nextSources, items }
}

/** `next` with the original's key order at every depth; a new key goes where `schemaKeys` puts it among the keys already there, or last. */
export function keyOrder<T>(next: T, original: unknown, schemaKeys: string[] = []): T {
  if (Array.isArray(next)) return next.map((v, i) => keyOrder(v, Array.isArray(original) ? original[i] : undefined)) as T
  if (!next || typeof next !== 'object') return next
  const orig = original && typeof original === 'object' && !Array.isArray(original) ? (original as Record<string, unknown>) : {}
  const keys = Object.keys(orig).filter((k) => k in next)
  for (const k of Object.keys(next)) {
    if (keys.includes(k)) continue
    const at = schemaKeys.indexOf(k)
    const before = at < 0 ? -1 : keys.findIndex((x) => schemaKeys.slice(at + 1).includes(x))
    keys.splice(before < 0 ? keys.length : before, 0, k)
  }
  return Object.fromEntries(keys.map((k) => [k, keyOrder((next as Record<string, unknown>)[k], orig[k])])) as T
}

/** The programme as its file should read: the file's own key order and formatting, so the diff shows only what changed. */
export function serialise(next: Programme, originalText: string): string {
  const original = JSON.parse(originalText) as Programme
  const shape = (programmeSchema as unknown as { shape: Record<string, { shape?: Record<string, unknown> }> }).shape
  const o = keyOrder(next, original, Object.keys(shape))
  o.evidence = keyOrder(next.evidence, original.evidence, Object.keys(shape.evidence!.shape!))
  const stringify = `${JSON.stringify(original, null, 2)}\n` === originalText && formatJson(original) !== originalText
  return stringify ? `${JSON.stringify(o, null, 2)}\n` : formatJson(o)
}

export function manifest(r: Result, today: string, bits: ReturnType<typeof apply>['manifestBits'], models: string[], usd: number): Manifest {
  return {
    id: r.id,
    read_on: today,
    prompt_version: PROMPT_VERSION,
    models,
    complete: r.gathered.complete && !r.error,
    reasons: [...r.gathered.reasons, ...(r.error ? [`error: ${r.error}`] : [])],
    requirements_checked: bits.requirements_checked,
    documents: r.gathered.docs.map((d) => ({ ref: d.ref, url: d.url, final_url: d.final_url, from: d.from, anchor: d.anchor, depth: d.depth, pdf: d.pdf, chars: d.text.length, pages: d.pages?.length ?? null, low_text: d.low_text, hash: d.hash })),
    failures: r.gathered.failures,
    skipped_links: r.gathered.skipped.length,
    chunks: r.chunks,
    outcomes: bits.outcomes,
    written: bits.written,
    escalated: r.escalated,
    flags: r.flags.map((f) => ({ field: f.field, item: f.item, why: f.why })),
    notes: [...r.notes, ...bits.notes].slice(0, 60),
    usd: Math.round(usd * 10000) / 10000,
  }
}
