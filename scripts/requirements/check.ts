/**
 * Stage 5, check: Jev (TypeSafe System One) asks narrow typed questions about each verified item, with the
 * item, its quote, the passage around it and the programme's facts as state. Every raw probability is kept
 * so the pilot can tune the thresholds offline. A broken item, a disagreement with the extractor or a
 * spread distribution becomes a flag; a field the text states but the extractor missed is an omission.
 */
import type { Programme } from '../../src/data/schema'
import { eligibilityKind } from '../../src/data/schema'
import { comparable } from '../../src/data/text'
import type { Chunk, Field } from './extract'
import { splitText } from './extract'
import type { Doc } from './gather'
import type { Answer, AskJev, Question } from './models'
import type { Facts, Flag, Quote } from './verify'

/** Where a probability becomes a flag. Tuned on the 40 tuning programmes; eval.ts reports each one's precision and recall. */
export const JEV = {
  /** P(broken) at or above this flags the item, unless `by` sets the question's own bar. */
  flag: 0.5,
  /**
   * Per-question bars, from hand-labelled tune-1 flags. Polarity flagged rules restated from an exclusion
   * list ("Not a for-profit" on "for-profits may not apply"): no true flag among 14 sampled, none of 4 at
   * 0.75 or above, so it is recorded but never flags. Selection, overreach and first_step at 0.5–0.75 were
   * mostly sound items (conditional documents, scope limits).
   */
  by: { polarity: Infinity, selection: 0.75, overreach: 0.8, first_step: 0.75 } as Record<string, number>,
  /** A Choice whose top option has less than this is too spread to trust. */
  confidence: 0.6,
  /** P(the text states this field) at or above this sends a not_found field back to extraction. */
  omission: 0.7,
}

/** One raw judgment, for the manifest and the threshold sweep. `broken` is the probability the item is wrong. */
export type Judgement = { field: Field; item: string; question: string; p: number; quote?: string; choice?: string; expected?: string }

const SECTION = 800
const OMISSION_CHARS = 24_000

/** The passage around a quote on its document, so Jev reads the quote in its context. */
export function section(docs: Doc[], q: Quote, around = SECTION): string {
  const d = docs.find((x) => x.ref === q.doc)
  if (!d) return q.quote
  const page = comparable(d.text)
  const at = page.indexOf(comparable(q.quote))
  if (at < 0 || page.length !== d.text.length) return q.quote
  return d.text.slice(Math.max(0, at - around), Math.min(d.text.length, at + q.quote.length + around))
}

const programmeState = (p: Programme) => ({
  name: p.name,
  funder: p.funder.name,
  rounds: p.calls.map((c) => ({ label: c.label, status: c.status, deadline: c.deadline?.date ?? null })),
  applicant_types: p.applicant_types,
})

/** P(yes), or null when Jev gave no answer. A missing answer is never read as a middling one. */
const noul = (a: Answer | undefined) => (a && a.type === 'noul' && Number.isFinite(a.noul) ? a.noul : null)

const OMISSION: Record<Field, string> = {
  eligibility: 'a hard requirement an applicant must meet to be allowed to apply (legal status, years operating, finances, capacity, project scope or partners), beyond a plain list of countries or organisation types',
  documents: 'a document applicants must submit with their application (certificates, accounts, budgets, letters, CVs), not the form itself',
  effort: 'the stages of applying (such as a concept note, a full proposal if invited, an interview) or when each is due',
  co_finance: 'whether applicants must bring matching funds or co-funding, or that none is required',
  consortium: 'whether applicants must apply as a consortium or partnership of several organisations, or may or must apply alone',
  after_award: 'what a grantee must do after the award: reports, an audit, site visits or required training or events',
}

/** Fields whose facts came back empty, or thin enough that the text may state more. */
export function thinFields(f: Facts): Field[] {
  const out: Field[] = []
  if (f.eligibility.length <= 1) out.push('eligibility')
  if (!f.documents.length) out.push('documents')
  if (!f.effort) out.push('effort')
  if (!f.co_finance_required) out.push('co_finance')
  if (!f.consortium_required) out.push('consortium')
  if (!f.after_award.length) out.push('after_award')
  return out
}

/** For each thin field, whether any chunk of the text states it. Chunks are cut to fit Jev's per-question context. */
export async function omissions(jev: AskJev, p: Programme, chunks: Chunk[], fields: Field[]): Promise<{ fields: Field[]; judgements: Judgement[] }> {
  const judgements: Judgement[] = []
  const best: Partial<Record<Field, number>> = {}
  if (!fields.length) return { fields: [], judgements }
  const pieces = chunks.flatMap((c) => splitText(c.text, OMISSION_CHARS).map((t, i) => ({ id: `${c.id}.${i + 1}`, text: t })))
  for (const piece of pieces) {
    const questions: Record<string, Question> = Object.fromEntries(
      fields.map((f) => [f, { type: 'noul', instructions: `Does \`text\` state ${OMISSION[f]} for this programme?`, criteria: { true: 'The text states it for this programme', false: 'The text does not state it, or states it only for another programme' } }]),
    )
    const answers = await jev(p.id, { programme: programmeState(p), text: piece.text }, questions)
    for (const f of fields) {
      // No answer: the text may state it, so the field is read again.
      const y = noul(answers[f]) ?? 1
      judgements.push({ field: f, item: piece.id, question: 'omission', p: y })
      best[f] = Math.max(best[f] ?? 0, y)
    }
  }
  return { fields: fields.filter((f) => (best[f] ?? 0) >= JEV.omission), judgements }
}

const typedOf = (e: { min_years?: number; revenue?: unknown; request_cap?: unknown }) => {
  const t = { ...(e.min_years !== undefined ? { min_years: e.min_years } : {}), ...(e.revenue ? { revenue: e.revenue } : {}), ...(e.request_cap ? { request_cap: e.request_cap } : {}) }
  return Object.keys(t).length ? t : null
}

/** Jev's questions about every verified item. Returns flags and every raw judgment. */
export async function check(jev: AskJev, p: Programme, facts: Facts, docs: Doc[]): Promise<{ flags: Flag[]; judgements: Judgement[] }> {
  const flags: Flag[] = []
  const judgements: Judgement[] = []
  const prog = programmeState(p)
  /** `broken` is P(the item is wrong); null (no answer) flags it. */
  const judge = (field: Field, item: string, question: string, broken: number | null, q: Quote, why: string, extra: Partial<Judgement> = {}) => {
    if (broken === null) {
      judgements.push({ field, item, question, p: 1, quote: q.quote, ...extra, choice: 'no answer' })
      flags.push({ field, item, why: `Jev gave no answer on: ${why}`, quote: q.quote, doc: q.doc, source: 'jev', p: 1 })
      return
    }
    judgements.push({ field, item, question, p: broken, quote: q.quote, ...extra })
    if (broken >= (JEV.by[question] ?? JEV.flag)) flags.push({ field, item, why, quote: q.quote, doc: q.doc, source: 'jev', p: broken })
  }
  const not = (y: number | null) => (y === null ? null : 1 - y)

  if (facts.eligibility.length) {
    const items = facts.eligibility.map((e) => ({ rule: e.rule, kind: e.kind, quote: e.q.quote, section: section(docs, e.q), ...(typedOf(e) ? { typed: typedOf(e) } : {}) }))
    const qs: Record<string, Question> = {}
    items.forEach((_, i) => {
      qs[`sel${i}`] = {
        type: 'noul',
        instructions: `Is \`items[${i}].rule\` a selection or scoring criterion, priority or preference (what makes a strong application), rather than a hard requirement an applicant must meet to be allowed to apply? Read \`items[${i}].section\`.`,
        criteria: { true: 'A criterion, priority or preference, not a hard requirement', false: 'A hard requirement: not meeting it rules the applicant out' },
      }
      qs[`over${i}`] = {
        type: 'noul',
        instructions: `Does \`items[${i}].rule\` say more than, or something other than, what \`items[${i}].quote\` states (a number, a condition or a scope the quote does not give)?`,
        criteria: { true: 'The rule adds to or changes what the quote says', false: 'The rule says what the quote says, in other words' },
      }
      qs[`pol${i}`] = {
        type: 'noul',
        instructions: `An applicant that meets \`items[${i}].rule\` exactly as written: by \`items[${i}].section\`, would that applicant be ruled out of applying?`,
        criteria: { true: 'Meeting the rule rules the applicant out: the rule is phrased backwards', false: 'Meeting the rule lets the applicant apply' },
      }
      if (items[i]!.typed)
        qs[`typed${i}`] = {
          type: 'noul',
          instructions: `Does \`items[${i}].quote\` state exactly the values in \`items[${i}].typed\` as this rule's threshold (min_years: the fewest years an applicant must have operated; revenue: the range the applicant's yearly revenue, budget or spending must fall in, in that currency; request_cap: the largest request as a percent of the applicant's yearly revenue or budget)?`,
          criteria: { true: 'The quote states these values for this rule', false: 'A value is missing, different, about something else, or read from a number that means something else' },
        }
      qs[`kind${i}`] = {
        type: 'choice',
        instructions: `What is \`items[${i}].rule\` about?`,
        criteria: {
          legal: 'Legal status, registration, independence, not being a government body',
          track_record: 'Years operating or past projects',
          finances: 'A financial bar: a revenue or turnover range, audited accounts, a request capped by revenue',
          capacity: 'Staff, systems or policies',
          project: "The project's scope, size, place or partners",
          other: 'None of these',
        },
      }
    })
    const a = await jev(p.id, { programme: prog, items }, qs)
    items.forEach((it, i) => {
      const q = facts.eligibility[i]!.q
      judge('eligibility', it.rule, 'selection', noul(a[`sel${i}`]), q, 'a selection criterion or preference, not a hard rule')
      judge('eligibility', it.rule, 'overreach', noul(a[`over${i}`]), q, 'the rule says more or other than its quote')
      judge('eligibility', it.rule, 'polarity', noul(a[`pol${i}`]), q, 'phrased backwards: meeting it would rule an applicant out')
      if (it.typed) judge('eligibility', it.rule, 'typed', not(noul(a[`typed${i}`])), q, `the quote does not state ${JSON.stringify(it.typed)}`, { expected: JSON.stringify(it.typed) })
      const k = a[`kind${i}`]
      if (k && k.type === 'choice' && eligibilityKind.options.includes(k.choice as never)) {
        const disagree = k.choice !== it.kind
        judgements.push({ field: 'eligibility', item: it.rule, question: 'kind', p: 1 - (k.probabilities[it.kind] ?? 0), quote: q.quote, choice: k.choice, expected: it.kind })
        if (disagree && k.confidence >= JEV.confidence) flags.push({ field: 'eligibility', item: it.rule, why: `kind is ${it.kind}, Jev reads ${k.choice}`, quote: q.quote, doc: q.doc, source: 'jev', p: k.confidence })
        // A typed value rides on its kind, so a doubtful kind on a typed rule is worth a second look.
        else if (k.confidence < JEV.confidence && (facts.eligibility[i]!.min_years || facts.eligibility[i]!.revenue || facts.eligibility[i]!.request_cap))
          flags.push({ field: 'eligibility', item: it.rule, why: `kind is unclear (${k.choice} at ${k.confidence.toFixed(2)}) on a rule with typed values`, quote: q.quote, doc: q.doc, source: 'jev', p: k.confidence })
      } else flags.push({ field: 'eligibility', item: it.rule, why: 'Jev gave no answer on what the rule is about', quote: q.quote, doc: q.doc, source: 'jev', p: 1 })
    })
  }

  if (facts.documents.length) {
    const items = facts.documents.map((d) => ({ document: d.item, quote: d.q.quote, section: section(docs, d.q) }))
    const qs: Record<string, Question> = Object.fromEntries(
      items.map((_, i) => [
        `first${i}`,
        {
          type: 'noul',
          instructions: `By \`items[${i}].section\`, must applicants submit \`items[${i}].document\` with their application at the first step, rather than only later (if invited, before signing or after the award) or not at all?`,
          criteria: { true: 'Submitted at the first step', false: 'Only later, optional, or not a document applicants submit' },
        },
      ]),
    )
    const a = await jev(p.id, { programme: prog, items }, qs)
    items.forEach((it, i) => judge('documents', it.document, 'first_step', not(noul(a[`first${i}`])), facts.documents[i]!.q, 'not asked for at the first step'))
  }

  if (facts.effort?.steps.length) {
    const all = facts.effort.steps
    const steps = all.map((s) => ({ step: s.step, due: s.due, quote: s.q.quote, section: section(docs, s.q) }))
    const qs: Record<string, Question> = {}
    all.forEach((s, i) => {
      qs[`step${i}`] = {
        type: 'noul',
        instructions: `By \`steps[${i}].section\`, is \`steps[${i}].step\` a stage applicants to this programme go through when applying (in this order, as \`steps\` lists them)?`,
        criteria: { true: 'A stage of applying, as the text describes it', false: 'Not a stage of applying, another programme’s, or not what the text says' },
      }
      if (s.due)
        qs[`due${i}`] = {
          type: 'noul',
          instructions: `Is \`steps[${i}].due\` the date \`steps[${i}].step\` is due in the current or next round, by \`steps[${i}].section\`, rather than another step's date, an opening date, a decision date or a past round's date?`,
          criteria: { true: 'It is when that step is due', false: 'It is some other date' },
        }
    })
    const a = await jev(p.id, { programme: prog, steps }, qs)
    all.forEach((s, i) => {
      judge('effort', s.step, 'step', not(noul(a[`step${i}`])), s.q, `"${s.step}" is not a stage of applying the text describes`)
      if (s.due) judge('effort', s.step, 'due', not(noul(a[`due${i}`])), s.q, `${s.due} is not when "${s.step}" is due`, { expected: s.due })
    })
  }

  const yesNo: { field: Field; value: { value: boolean; q: Quote } | null; question: string }[] = [
    { field: 'co_finance', value: facts.co_finance_required, question: 'By `section`, must applicants bring matching funds or co-funding (their own or third-party cash or in-kind) toward the project?' },
    { field: 'consortium', value: facts.consortium_required, question: 'By `section`, must applicants apply as a consortium or partnership of several organisations (not just may)?' },
  ]
  for (const y of yesNo) {
    if (!y.value) continue
    const a = await jev(p.id, { programme: prog, section: section(docs, y.value.q) }, { v: { type: 'noul', instructions: y.question } })
    const yes = noul(a.v)
    judge(y.field, 'required', 'required', y.value.value ? not(yes) : yes, y.value.q, `the text does not say ${y.value.value ? 'it is required' : 'it is not required'}`, { expected: String(y.value.value) })
  }

  // Each co-funding detail is its own claim.
  const cf = facts.co_finance
  if (cf) {
    const claims: [string, string][] = []
    if (cf.min_share !== undefined) claims.push(['min_share', `applicants must bring at least ${cf.min_share}% of the project cost`])
    if (cf.ratio !== undefined) claims.push(['ratio', `the match is ${cf.ratio} (applicant's share to the grant, as the text states it)`])
    if (cf.min_amount) claims.push(['min_amount', `applicants must bring at least ${cf.min_amount.value} ${cf.min_amount.currency}`])
    if (cf.in_kind) claims.push(['in_kind', 'in-kind contributions (staff time, land, equipment) count toward the co-funding'])
    if (claims.length) {
      const a = await jev(
        p.id,
        { programme: prog, section: section(docs, cf.q) },
        Object.fromEntries(claims.map(([k, c]) => [`cf_${k}`, { type: 'noul', instructions: `By \`section\`, is this true of this programme's co-funding: ${c}?` }])),
      )
      for (const [k, c] of claims) judge('co_finance', k, 'co_finance', not(noul(a[`cf_${k}`])), cf.q, `the text does not say ${c}`, { expected: JSON.stringify((cf as Record<string, unknown>)[k]) })
    }
  }

  // Each after-award duty is its own claim.
  if (facts.after_award.length) {
    const DUTY: Record<string, string> = {
      reports: 'submit reports on the grant',
      audit: 'have the grant externally or independently audited',
      site_visits: 'receive visits from the funder at the project site',
      training: 'take part in training, a capacity programme or events',
    }
    const a = await jev(
      p.id,
      { programme: prog, duties: facts.after_award.map((d) => ({ duty: d.duty, section: section(docs, d.q) })) },
      Object.fromEntries(facts.after_award.map((d, i) => [`duty${i}`, { type: 'noul', instructions: `By \`duties[${i}].section\`, must a grantee of this programme ${DUTY[d.duty]}?` }])),
    )
    facts.after_award.forEach((d, i) => judge('after_award', d.duty, 'duty', not(noul(a[`duty${i}`])), d.q, `the text does not say grantees must ${DUTY[d.duty]}`))
  }

  const reports = facts.after_award.find((d) => d.duty === 'reports')
  if (reports?.reports) {
    const a = await jev(
      p.id,
      { programme: prog, section: section(docs, reports.q) },
      {
        r: {
          type: 'choice',
          instructions: 'By `section`, how often must a grantee report, by the most frequent required report?',
          criteria: {
            final: 'One report at the end',
            interim_and_final: 'One or two interim reports and a final report',
            yearly: 'Every year',
            twice_yearly: 'Every six months',
            quarterly: 'Quarterly or more often',
            other: 'A stated schedule none of these fit, such as at set milestones',
            unspecified: 'Reports are required; how often is not stated',
          },
        },
      },
    )
    const r = a.r
    if (!r || r.type !== 'choice') flags.push({ field: 'after_award', item: 'reports', why: 'Jev gave no answer on how often grantees report', quote: reports.q.quote, doc: reports.q.doc, source: 'jev', p: 1 })
    else {
      judgements.push({ field: 'after_award', item: 'reports', question: 'reports', p: 1 - (r.probabilities[reports.reports] ?? 0), quote: reports.q.quote, choice: r.choice, expected: reports.reports })
      if (r.choice !== reports.reports && r.confidence >= JEV.confidence) flags.push({ field: 'after_award', item: 'reports', why: `reports read as ${reports.reports}, Jev reads ${r.choice}`, quote: reports.q.quote, doc: reports.q.doc, source: 'jev', p: r.confidence })
      else if (r.choice !== reports.reports) flags.push({ field: 'after_award', item: 'reports', why: `report frequency is unclear (${r.choice} at ${r.confidence.toFixed(2)})`, quote: reports.q.quote, doc: reports.q.doc, source: 'jev', p: r.confidence })
    }
  }

  return { flags, judgements }
}
