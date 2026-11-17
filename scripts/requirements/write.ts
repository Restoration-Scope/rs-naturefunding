/**
 * Stage 7, write: verified facts go into the programme file surgically, one field at a time, each held to
 * the full schema; a field that breaks it is reverted and left unresolved. A reading that disagrees with a
 * value already in the file keeps the old value and leaves the field unresolved for a person.
 * `requirements_checked` is set only when coverage is complete and no field is unresolved. The coverage
 * manifest goes to data/requirements/<id>.json: documents, hashes, chunks, outcomes and cost, no page text.
 */
import { programme as programmeSchema, type Evidence, type Programme, type Source } from '../../src/data/schema'
import { comparable } from '../../src/data/text'
import type { Field } from './extract'
import { FIELDS, PROMPT_VERSION } from './extract'
import type { Doc } from './gather'
import type { Outcome, Result } from './pipeline'
import { packQuotes, type Quote } from './verify'

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

export function apply(p: Programme, r: Result, today: string, sources: Source[]): { next: Programme; manifestBits: Pick<Manifest, 'outcomes' | 'written' | 'notes' | 'requirements_checked'>; sources: Source[] } {
  const docs = new Map(r.gathered.docs.map((d) => [d.ref, d]))
  const outcomes = { ...r.outcomes }
  const notes: string[] = []
  const written: Field[] = []
  const ev = (q: Quote): Evidence => ({ source_url: docs.get(q.doc)!.url, quote: q.quote, checked_at: today, method: 'page' })
  const packed = (qs: Quote[], max: number) => packQuotes(r.gathered.docs, qs, max)
  let cur: Draft = structuredClone(p) as Draft
  const used: Quote[] = []

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
      tryField(field, (d) => {
        d.eligibility = f.eligibility.map(({ q: _q, ...rule }) => rule)
        d.evidence.eligibility = f.eligibility.map((e) => ev(e.q))
        return f.eligibility.map((e) => e.q)
      })
      continue
    }
    if (field === 'documents') {
      let items = f.documents
      let pk = packed(items.map((x) => x.q), 3)
      if (!pk) {
        // Too many separate passages: keep the items the three fullest passages state.
        const groups = new Map<string, number[]>()
        items.forEach((x, i) => groups.set(`${x.q.doc}|${comparable(x.q.quote)}`, [...(groups.get(`${x.q.doc}|${comparable(x.q.quote)}`) ?? []), i]))
        const keep = new Set([...groups.values()].sort((a, b) => b.length - a.length).slice(0, 3).flat())
        notes.push(`documents: ${items.length - keep.size} items dropped, more than 3 separate passages state them`)
        items = items.filter((_, i) => keep.has(i))
        pk = packed(items.map((x) => x.q), 3)
      }
      if (!pk) continue
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
      if (!pk) continue
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
      if (!pk) continue
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

  const unresolved = FIELDS.filter((x) => outcomes[x] === 'unresolved')
  const stamp = r.gathered.complete && unresolved.length === 0 && !r.error
  if (stamp) {
    const draft = structuredClone(cur)
    draft.requirements_checked = today
    if (programmeSchema.safeParse(draft).success) cur = draft
  }

  // The refresh reads a source through its selector: a new quote outside it would look gone, so that
  // source reads the whole page instead.
  const nextSources = sources.map((s) => ({ ...s }))
  for (const q of used) {
    const d = docs.get(q.doc) as Doc
    const s = nextSources.find((x) => x.url === d.url)
    if (s?.selector && !(d.selected && comparable(d.selected).includes(comparable(q.quote)))) {
      notes.push(`source ${s.id}: selector ${s.selector} dropped, a new quote sits outside it`)
      s.selector = null
    }
  }

  return { next: cur as Programme, manifestBits: { outcomes, written, notes, requirements_checked: stamp }, sources: nextSources }
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
