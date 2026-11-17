/**
 * One programme through stages 2–6: gather, extract, verify, check, escalate. The result is verified facts
 * per field with an outcome (stated, not_found, unresolved), the coverage, every flag and Jev judgment, and
 * the usage; write.ts turns it into the programme file and the manifest.
 */
import { z } from 'zod'
import type { Programme, Source } from '../../src/data/schema'
import { check, JEV, omissions, thinFields, type Judgement } from './check'
import { apiWire, chunksOf, extract, FIELDS, fromApi, SYSTEM, userPrompt, WHOLE_CHARS, type Chunk, type Field, type Wire } from './extract'
import { gather, type Gathered, type Reader } from './gather'
import type { Ask, AskJev } from './models'
import { emptyFacts, verify, type Facts, type Flag } from './verify'

export type Outcome = 'stated' | 'not_found' | 'unresolved'

export type Result = {
  id: string
  gathered: Gathered
  chunks: { id: string; docs: string[]; chars: number }[]
  facts: Facts
  outcomes: Record<Field, Outcome>
  flags: Flag[]
  /** Flags the strong model settled; kept so the pilot can tell Jev's true flags from false ones. */
  settled: Flag[]
  judgements: Judgement[]
  notes: string[]
  escalated: Field[]
  error?: string
}

export type Deps = { read: Reader; sources: Source[]; cheap: Ask; strong: Ask | null; jev: AskJev | null }

const escalationWire = apiWire.extend({
  unresolved: z.array(z.enum(FIELDS)).describe('Fields the text leaves genuinely unclear, so a person must read them.'),
})

const hasField = (f: Facts, field: Field) =>
  ({
    eligibility: f.eligibility.length > 0,
    documents: f.documents.length > 0,
    effort: f.effort !== null,
    co_finance: f.co_finance_required !== null,
    consortium: f.consortium_required !== null,
    after_award: f.after_award.length > 0,
  })[field]

/** Takes one field's facts from `from` into `into`. */
function setField(into: Facts, from: Facts, field: Field) {
  if (field === 'eligibility') into.eligibility = from.eligibility
  if (field === 'documents') into.documents = from.documents
  if (field === 'effort') into.effort = from.effort
  if (field === 'co_finance') {
    into.co_finance_required = from.co_finance_required
    into.co_finance = from.co_finance
  }
  if (field === 'consortium') into.consortium_required = from.consortium_required
  if (field === 'after_award') into.after_award = from.after_award
}

/** The text the strong model re-reads: everything when it fits, else the chunks holding the flagged documents. */
function escalationText(chunks: Chunk[], flags: Flag[], omitted: Set<string>): Chunk | null {
  if (chunks.length === 1) return chunks[0]!
  const docs = new Set(flags.map((f) => f.doc).filter(Boolean))
  const pick = chunks.filter((c) => c.docs.some((d) => docs.has(d)) || omitted.has(c.id))
  const text = pick.map((c) => c.text).join('\n\n')
  return pick.length && text.length <= WHOLE_CHARS ? { id: 'escalation', docs: [...new Set(pick.flatMap((c) => c.docs))], text } : null
}

export async function run(p: Programme, deps: Deps): Promise<Result> {
  const gathered = await gather(p, { read: deps.read, sources: deps.sources, jev: deps.jev })
  const chunks = chunksOf(gathered.docs)
  const base: Result = {
    id: p.id,
    gathered,
    chunks: chunks.map((c) => ({ id: c.id, docs: c.docs, chars: c.text.length })),
    facts: emptyFacts(),
    outcomes: Object.fromEntries(FIELDS.map((f) => [f, 'unresolved'])) as Record<Field, Outcome>,
    flags: [],
    settled: [],
    judgements: [],
    notes: [],
    escalated: [],
  }
  if (!gathered.docs.length) return { ...base, notes: ['nothing to read'] }

  const first = await extract(deps.cheap, p, chunks)
  const v = verify(first.merged, gathered.docs)
  const facts = v.facts
  let flags: Flag[] = [...v.flags]
  const notes = [...v.notes, ...(first.merged.notes ? [`extractor: ${first.merged.notes}`] : [])]
  const judgements: Judgement[] = []
  for (const f of first.conflicts) flags.push({ field: f, item: 'required', why: 'parts of the text disagree', source: 'verify' })
  // Steps read from several chunks were put together by code, not read as one list.
  for (const f of first.spans) flags.push({ field: f, item: 'steps', why: 'the steps come from different parts of the text; check they are one list in order', source: 'verify' })
  // The text names a rules document we don't have: never a full read.
  const coverage = [...gathered.reasons]
  for (const m of first.missing) coverage.push(`the text names a document with rules that was not read: ${m.slice(0, 160)}`)

  // Omissions: Jev reads every chunk for fields that came back empty or thin; a yes sends them back.
  const omittedChunks = new Set<string>()
  let unseen: Field[] = []
  if (deps.jev) {
    const thin = thinFields(facts)
    const o = await omissions(deps.jev, p, chunks, thin)
    judgements.push(...o.judgements)
    for (const j of o.judgements) if (j.p >= JEV.omission) omittedChunks.add(j.item.split('.')[0]!)
    if (o.fields.length) {
      const again = await extract(deps.cheap, p, chunks, o.fields)
      const v2 = verify(again.merged, gathered.docs)
      notes.push(...v2.notes)
      for (const f of o.fields) {
        // Keep the fuller reading of a thin field; a field still empty goes to the strong model.
        const before = JSON.stringify(pickField(facts, f)).length
        if (JSON.stringify(pickField(v2.facts, f)).length > before) setField(facts, v2.facts, f)
        flags.push(...v2.flags.filter((x) => x.field === f))
        if (!hasField(facts, f)) unseen.push(f)
      }
      for (const f of unseen) flags.push({ field: f, item: f, why: `Jev reads the text as stating ${f}, but extraction found none`, source: 'jev' })
    }
    const c = await check(deps.jev, p, facts, gathered.docs)
    flags.push(...c.flags)
    judgements.push(...c.judgements)
  }

  // Escalate every flagged field once; its answer is verified and checked again.
  const flagged = [...new Set(flags.map((f) => f.field))]
  const escalated: Field[] = []
  const unresolved = new Set<Field>()
  const settled: Flag[] = []
  if (flagged.length && deps.strong) {
    const chunk = escalationText(chunks, flags, omittedChunks)
    if (!chunk) {
      for (const f of flagged) unresolved.add(f)
      notes.push('the flagged text is too long for one escalation')
    } else {
      const context = flags.map((f) => `- ${f.field}: "${f.item}": ${f.why}${f.quote ? ` (quote: "${f.quote.slice(0, 200)}")` : ''}`).join('\n')
      const user = `${userPrompt(p, chunk, 1, flagged)}\n\nA first reader's answer had these problems:\n${context}\n\nRead the text again and give the correct answer for ${flagged.join(', ')}. Leave out anything the text does not state. List in "unresolved" any of these fields the text leaves genuinely unclear.`
      const raw = await deps.strong(p.id, SYSTEM, user, escalationWire)
      const s = { ...fromApi(raw), unresolved: raw.unresolved }
      const v3 = verify(s, gathered.docs)
      notes.push(...v3.notes.map((n) => `strong: ${n}`), ...(s.notes ? [`strong: ${s.notes}`] : []))
      let after: Flag[] = v3.flags.filter((f) => flagged.includes(f.field))
      if (deps.jev) {
        const c = await check(deps.jev, p, onlyFields(v3.facts, flagged), gathered.docs)
        judgements.push(...c.judgements.map((j) => ({ ...j, question: `${j.question}@strong` })))
        after.push(...c.flags)
      }
      for (const f of flagged) {
        escalated.push(f)
        if (s.unresolved.includes(f) || after.some((x) => x.field === f)) {
          unresolved.add(f)
          continue
        }
        // The strong model settled it: its reading replaces the first one.
        setField(facts, v3.facts, f)
        settled.push(...flags.filter((x) => x.field === f))
        unseen = unseen.filter((u) => u !== f)
      }
      flags = [...flags.filter((x) => unresolved.has(x.field)), ...after.filter((x) => unresolved.has(x.field))]
    }
  } else for (const f of flagged) unresolved.add(f)

  const outcomes = Object.fromEntries(FIELDS.map((f) => [f, unresolved.has(f) ? 'unresolved' : hasField(facts, f) ? 'stated' : 'not_found'])) as Record<Field, Outcome>
  const complete = coverage.length === 0
  return { ...base, gathered: { ...gathered, complete, reasons: [...new Set(coverage)] }, facts, outcomes, flags, settled, judgements, notes, escalated }
}

function pickField(f: Facts, field: Field) {
  const one: Facts = emptyFacts()
  setField(one, f, field)
  return one
}

function onlyFields(f: Facts, fields: Field[]): Facts {
  const one: Facts = emptyFacts()
  for (const x of fields) setField(one, f, x)
  return one
}

export function emptyWire(): Wire {
  const nf = { status: 'not_found' as const }
  return {
    eligibility: { ...nf, items: [] },
    documents: { ...nf, items: [] },
    effort: { ...nf, steps: [], more_after: false },
    co_finance: { ...nf, required: null, doc: null, quote: null, min_share: null, ratio: null, min_amount: null, in_kind: null, applies_to: null, detail_doc: null, detail_quote: null },
    consortium: { ...nf, required: null, doc: null, quote: null },
    after_award: { ...nf, items: [] },
    notes: '',
  }
}
