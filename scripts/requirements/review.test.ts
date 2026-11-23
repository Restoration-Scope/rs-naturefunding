import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lint, type LintInput } from './lint'
import { REVIEW_FROM, applyVerdicts, brief, family, itemsHash, itemsOf, reviewGaps, reviewProblems, verdict, type Verdict } from './review'

const ev = (url: string, quote: string) => ({ source_url: url, quote, checked_at: '2026-11-24', method: 'page' })
const CALL = 'https://funder.example.org/call'
const OTHER = 'https://funder.example.org/other-programme-rfp.pdf'
const programme = () => ({
  id: 'p',
  name: 'Wetland Grants',
  url: CALL,
  geography: { scope: 'countries', countries: ['CA'], label: 'British Columbia' },
  applicant_types: ['ngo'],
  calls: [],
  eligibility: [
    { rule: 'Be a registered charity', kind: 'legal' },
    { rule: 'Operating for at least 3 years', kind: 'track_record', min_years: 3 },
    { rule: 'Not a federal agency', kind: 'legal' },
  ],
  documents: ['Registration certificate', 'Application form'],
  effort: { steps: ['Concept note', 'Board decision', 'Full proposal, if invited'], due: ['2026-12-01', null, null] },
  co_finance_required: true,
  co_finance: { min_share: 50 },
  evidence: {
    eligibility: [ev(CALL, 'Applicants must be registered charities.'), ev(CALL, 'Organisations must have operated for at least three years.'), ev(OTHER, 'Federal agencies may not apply to this RFP.')],
    documents: [ev(CALL, 'Attach your registration certificate to the application form.')],
    effort: [ev(CALL, 'Concept notes are due on 1 December 2026.')],
    co_finance_required: ev(CALL, 'Applicants must match the grant one to one.'),
    co_finance: ev(CALL, 'Applicants must match the grant one to one.'),
  },
})
const POOLED = ['documents', 'effort', 'after_award']
// A sound verdict on a pooled item names every quote of its field as stating it, unless a test says otherwise.
const sound = (p: { id: string; evidence: Record<string, unknown> }): Verdict[] =>
  itemsOf(p).map((it) => ({
    id: p.id, field: it.field, index: it.index, text: it.text, verdict: 'sound', category: 'ok', action: 'keep', reason: 'stated',
    ...(POOLED.includes(it.field) ? { quotes: ((p.evidence[it.field] as unknown[] | undefined) ?? []).map((_, i) => i) } : {}),
  }))
const set = (vs: Verdict[], field: string, index: number, patch: Partial<Verdict>) => vs.map((v) => (v.field === field && v.index === index ? { ...v, ...patch } : v))

describe('review', () => {
  test('every item and every cited document is numbered for a verdict', () => {
    const items = itemsOf(programme())
    expect(items.filter((x) => x.field === 'source').map((x) => x.text)).toEqual([CALL, OTHER])
    expect(items.find((x) => x.field === 'eligibility' && x.index === 2)?.source).toBe(1)
    expect(items.filter((x) => x.field === 'effort')).toHaveLength(3)
    expect(items.some((x) => x.field === 'co_finance')).toBe(true)
  })

  test('the brief plants a canary on a real quote, outside the file', () => {
    const p = programme()
    const b = brief([p], { stamp: 's', dir: '.cache/review/s', standards: 'standards: t.1\n# Review standards', worktree: '.' })
    const c = b.key.canaries[0]!
    expect(c.index).toBe(3)
    expect(p.evidence.eligibility.map((e) => e.quote)).toContain(c.quote!)
    expect(b.text).toContain(`3. ${c.text}`)
    expect(b.key.standards).toBe('t.1')
    expect(p.eligibility).toHaveLength(3)
    // A quote with a number never carries a canary, in any language: the planted rule might be true.
    const numbered = { ...p, evidence: { ...p.evidence, eligibility: [ev(CALL, 'Mindestens 3 Jahre tätig.')] }, eligibility: [{ rule: 'Operating for at least 3 years', kind: 'track_record' }] }
    const d = brief([numbered], { stamp: 's', dir: 'd', standards: 'standards: t.1', worktree: '.' })
    expect(d.key.canaries[0]).toMatchObject({ field: 'documents', index: 2 })
    expect(d.text).toContain(`2. ${d.key.canaries[0]!.text}`)
    // A brief no programme can test the reviewer on is refused.
    expect(() => brief([{ ...numbered, documents: undefined }], { stamp: 's', dir: 'd', standards: 'standards: t.1', worktree: '.' })).toThrow('canary')
  })

  test('a review applies only when every item has its verdict and every canary is caught', () => {
    const p = programme()
    const { key } = brief([p], { stamp: 's', dir: 'd', standards: 'standards: t.1', worktree: '.' })
    const c = key.canaries[0]!
    const canary: Verdict = { id: 'p', field: 'eligibility', index: c.index, text: c.text, verdict: 'wrong', category: 'says_more_than_quote', action: 'drop', reason: 'not in the quote' }
    expect(reviewGaps([p], key, [...sound(p), canary])).toEqual([])
    expect(reviewGaps([p], key, sound(p)).join()).toContain('canary')
    expect(reviewGaps([p], key, [...sound(p).slice(1), canary]).join()).toContain('0 verdicts')
    // A dropped source takes the items it supports with it.
    const dropOther = set(sound(p), 'source', 1, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' })
    expect(reviewGaps([p], key, [...dropOther, canary]).join()).toContain('its source')
    const both = set(dropOther, 'eligibility', 2, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' })
    expect(reviewGaps([p], key, [...both, canary])).toEqual([])
    // A file edited after the brief needs a new one.
    const edited = { ...p, documents: ['Registration certificate'] }
    expect(reviewGaps([edited], key, [...sound(p), canary]).join()).toContain('changed after the brief')
  })

  test('verdicts become edits, quotes and all', () => {
    const p = programme()
    let vs = sound(p)
    vs = set(vs, 'eligibility', 1, { verdict: 'wrong', category: 'says_more_than_quote', action: 'replace', new: { text: 'Operating for at least 2 years', quote: 'Organisations must have operated for at least two years.', source_url: CALL } })
    vs = set(vs, 'eligibility', 2, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' })
    vs = set(vs, 'documents', 1, { verdict: 'wrong', category: 'document_is_application', action: 'drop' })
    vs = set(vs, 'effort', 1, { verdict: 'wrong', category: 'step_not_a_stage', action: 'drop' })
    vs = set(vs, 'effort', 0, { verdict: 'wrong', category: 'other', action: 'reword', new: { text: 'Concept note by email' } })
    vs = set(vs, 'co_finance_required', 0, { verdict: 'wrong', category: 'cofinance_wrong', action: 'drop' })
    vs.push({ id: 'p', field: 'documents', index: null, text: 'Annual report', verdict: 'missed', category: 'missed_document', action: 'add', reason: 'listed', new: { text: 'Latest annual report', quote: 'Include your latest annual report.', source_url: CALL } })
    const next = applyVerdicts(p, vs, '2026-11-24')
    expect(next.eligibility).toEqual([{ rule: 'Be a registered charity', kind: 'legal' }, { rule: 'Operating for at least 2 years', kind: 'track_record' }])
    expect(next.evidence.eligibility.map((e: { quote: string }) => e.quote)).toEqual(['Applicants must be registered charities.', 'Organisations must have operated for at least two years.'])
    expect(next.documents).toEqual(['Registration certificate', 'Latest annual report'])
    expect(next.evidence.documents).toHaveLength(2)
    expect(next.effort).toEqual({ steps: ['Concept note by email', 'Full proposal, if invited'], due: ['2026-12-01', null] })
    expect(next.co_finance_required).toBeNull()
    expect(next.co_finance).toBeUndefined()
    expect(next.evidence.co_finance).toBeUndefined()
    expect(p.eligibility).toHaveLength(3)
  })

  test('a review is refused when its edits would leave a fact unsupported or ambiguous', () => {
    const p = programme()
    const { key } = brief([p], { stamp: 's', dir: 'd', standards: 'standards: t.1', worktree: '.' })
    const c = key.canaries[0]!
    const canary: Verdict = { id: 'p', field: 'eligibility', index: c.index, text: c.text, verdict: 'wrong', category: 'says_more_than_quote', action: 'drop', reason: 'not in the quote' }
    // A canary verdict on other text is not a catch.
    expect(reviewGaps([p], key, [...sound(p), { ...canary, text: 'Something else entirely, not the canary' }]).join()).toContain('canary')
    // A pooled field whose every quote comes from a dropped source can't keep its items.
    const docsElsewhere = { ...p, evidence: { ...p.evidence, documents: [ev(OTHER, 'Attach your registration certificate.')] } }
    const k2 = { ...key, hashes: { p: itemsHash(docsElsewhere) } }
    let vs = set(sound(docsElsewhere), 'source', 1, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' })
    vs = set(vs, 'eligibility', 2, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' })
    expect(reviewGaps([docsElsewhere], k2, [...vs, canary]).join()).toContain('documents 0: its source was dropped')
    // A named quote that doesn't exist is a gap.
    expect(reviewGaps([p], key, [...set(sound(p), 'documents', 1, { quotes: [4] }), canary]).join()).toContain('no quote q4')
    // A kept document or step names the quotes that state it.
    expect(reviewGaps([p], key, [...set(sound(p), 'documents', 0, { quotes: undefined }), canary]).join()).toContain('name the quotes')
    // A kept item whose named quotes all come from a dropped source goes too, though the field keeps other quotes.
    const split = { ...p, evidence: { ...p.evidence, documents: [ev(CALL, 'Attach your registration certificate.'), ev(OTHER, 'Use the RFP application form.')] } }
    const k3 = { ...key, hashes: { p: itemsHash(split) } }
    let sv = set(set(sound(split), 'source', 1, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' }), 'eligibility', 2, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' })
    sv = set(set(sv, 'documents', 0, { quotes: [0] }), 'documents', 1, { quotes: [1] })
    expect(reviewGaps([split], k3, [...sv, canary]).join()).toContain('documents 1: its source was dropped')
    expect(reviewGaps([split], k3, [...set(sv, 'documents', 1, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' }), canary])).toEqual([])
    // The reviewer's family is told apart from the reading's models.
    expect([family('cursor:gpt-5.6-luna-high'), family('claude-opus-5-5'), family('gemini-4-neon')]).toEqual(['openai', 'anthropic', 'google'])
    // One-value fields: no rewording, one change each, typed values.
    expect(reviewGaps([p], key, [...set(sound(p), 'co_finance', 0, { verdict: 'wrong', category: 'cofinance_wrong', action: 'reword', new: { text: '20% match' } }), canary]).join()).toContain('not reworded')
    const add = (value: unknown): Verdict => ({ id: 'p', field: 'after_award', index: null, text: 'duty', verdict: 'missed', category: 'missed_fact', action: 'add', reason: 'stated', new: { value, quote: 'Grantees report yearly.', source_url: CALL } })
    expect(reviewGaps([p], key, [...sound(p), canary, add({ reports: 'final' }), add({ audit: true })]).join()).toContain('one at most')
  })

  test('edits keep every fact supported', () => {
    const p = programme()
    // A dropped source's pooled quotes go with it.
    const mixed = { ...p, evidence: { ...p.evidence, documents: [ev(CALL, 'Attach your registration certificate.'), ev(OTHER, 'Attach the RFP form.')] } }
    const vs = set(sound(mixed), 'source', 1, { verdict: 'wrong', category: 'wrong_round_or_programme', action: 'drop' })
    expect(applyVerdicts(mixed, vs, '2026-11-24').evidence.documents.map((e: { source_url: string }) => e.source_url)).toEqual([CALL])
    // A pooled quote stays only when a kept item names it, in any language, so a new one fits under the cap.
    const four = { ...p, documents: ['Checklist', 'Project narrative, maximum 2 pages', 'Project area map', 'Itemized budget'], evidence: { ...p.evidence, documents: [ev(CALL, 'Grant checklist (required)'), ev(CALL, 'Projektbeschreibung (höchstens 2 Seiten)'), ev(CALL, 'include a map of the project area'), ev(CALL, 'Include an itemized budget.')] } }
    let ds = set(set(sound(four), 'documents', 1, { verdict: 'wrong', category: 'document_is_application', action: 'drop' }), 'documents', 2, { verdict: 'wrong', category: 'document_is_application', action: 'drop' })
    ds = set(set(ds, 'documents', 0, { quotes: [0] }), 'documents', 3, { quotes: [3] })
    ds = [...ds, { id: 'p', field: 'documents', index: null, text: 'Letter of support', verdict: 'missed', category: 'missed_document', action: 'add', reason: 'listed', new: { text: 'Letter of support', quote: 'Include a letter of support.', source_url: CALL } }]
    const pruned = applyVerdicts(four, ds, '2026-11-24')
    expect(pruned.documents).toEqual(['Checklist', 'Itemized budget', 'Letter of support'])
    expect(pruned.evidence.documents.map((e: { quote: string }) => e.quote)).toEqual(['Grant checklist (required)', 'Include an itemized budget.', 'Include a letter of support.'])
    // A quote a kept item still names stays, so the cap refuses the new one.
    expect(() => applyVerdicts(four, set(ds, 'documents', 0, { quotes: [0, 1, 2] }), '2026-11-24')).toThrow('the most it takes')
    // after_award: a replace keeps the old quotes it names beside the new one.
    const duties = { ...p, after_award: { reports: 'yearly' }, evidence: { ...p.evidence, after_award: [ev(CALL, 'Grantees report every year.'), ev(CALL, 'Accounts are audited.')] } }
    const aa = set(sound(duties), 'after_award', 0, { verdict: 'wrong', category: 'missed_fact', action: 'replace', quotes: [0, 1], new: { value: { reports: 'yearly', audit: true, site_visit: true }, quote: 'We visit every site.', source_url: CALL } })
    expect(applyVerdicts(duties, aa, '2026-11-24').evidence.after_award.map((e: { quote: string }) => e.quote)).toEqual(['Grantees report every year.', 'Accounts are audited.', 'We visit every site.'])
    // A new quote past the cap is refused, not silently left out.
    const full = { ...p, evidence: { ...p.evidence, documents: [ev(CALL, 'One.'), ev(CALL, 'Two.'), ev(CALL, 'Three.')] } }
    const replace = set(sound(full), 'documents', 0, { verdict: 'wrong', category: 'other', action: 'replace', new: { text: 'Charity number', quote: 'Give your charity number.', source_url: CALL } })
    expect(() => applyVerdicts(full, replace, '2026-11-24')).toThrow('the most it takes')
    // A wrong date is corrected; a dropped consortium requirement is left out, not null.
    let ws = set(sound(p), 'effort', 0, { verdict: 'wrong', category: 'due_wrong', action: 'reword', new: { due: null } })
    expect(applyVerdicts(p, ws, '2026-11-24').effort.due).toBeUndefined()
    const withConsortium = { ...p, consortium_required: true, evidence: { ...p.evidence, consortium_required: ev(CALL, 'Apply as a consortium.') } }
    ws = set(sound(withConsortium), 'consortium_required', 0, { verdict: 'wrong', category: 'other', action: 'drop' })
    const next = applyVerdicts(withConsortium, ws, '2026-11-24')
    expect('consortium_required' in next).toBe(false)
    expect(next.evidence.consortium_required).toBeUndefined()
    // Key order is not a change.
    const a = { ...p, after_award: { reports: 'yearly', audit: true } }
    const b = { ...p, after_award: { audit: true, reports: 'yearly' } }
    expect(itemsHash(a)).toBe(itemsHash(b))
  })

  test('validate fails a reading from REVIEW_FROM on without a review that matches its items', () => {
    const p = programme()
    const review = { on: REVIEW_FROM, standards: 't.1', reviewer: 'x', hash: itemsHash(p), verdicts: { sound: 1, wrong: 0, missed: 0 }, canaries: { planted: 1, caught: 1 } }
    expect(reviewProblems([p], [{ id: 'p', read_on: '2026-11-23' }])).toEqual([])
    expect(reviewProblems([p], [{ id: 'p', read_on: REVIEW_FROM }]).join()).toContain('no second reader')
    expect(reviewProblems([p], [{ id: 'p', read_on: REVIEW_FROM, review }])).toEqual([])
    expect(reviewProblems([{ ...p, documents: ['Registration certificate'] }], [{ id: 'p', read_on: REVIEW_FROM, review }]).join()).toContain('changed after its review')
    // The day a quote was last checked is not part of what was reviewed.
    const rechecked = { ...p, evidence: { ...p.evidence, eligibility: p.evidence.eligibility.map((e) => ({ ...e, checked_at: '2027-01-01' })) } }
    expect(reviewProblems([rechecked], [{ id: 'p', read_on: REVIEW_FROM, review }])).toEqual([])
    // A reading from REVIEW_FROM on with no manifest can't skip the review.
    expect(reviewProblems([{ ...p, requirements_checked: REVIEW_FROM }], []).join()).toContain('no reading manifest')
    expect(reviewProblems([{ ...p, requirements_checked: '2026-11-01' }], [])).toEqual([])
  })
})

const LABELS = join('tests', 'fixtures', 'review-labels')
const labels = readdirSync(LABELS)
  .filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(join(LABELS, f), 'utf8').trim().split('\n'))
  .map((l) => verdict.parse(JSON.parse(l)))

describe('lint against the reviewers labels', () => {
  test('most of what each check flags, reviewers called wrong', () => {
    const groups = Map.groupBy(labels, (r) => `${r.batch}|${r.id}`)
    let wrong = 0
    let flagged = 0
    for (const [k, rs] of groups) {
      const file = join('data', 'programmes', `${k.split('|')[1]}.json`)
      const geography = (() => {
        try {
          return JSON.parse(readFileSync(file, 'utf8')).geography
        } catch {
          return null
        }
      })()
      const at = (f: string) => rs.filter((r) => r.field === f && r.verdict !== 'missed' && r.index !== null).sort((a, b) => a.index! - b.index!)
      const el = at('eligibility')
      const x: LintInput = { eligibility: el.map((r) => ({ rule: r.text, quote: r.quote ?? undefined })), documents: at('documents').map((r) => r.text), steps: at('effort').map((r) => r.text), geography }
      for (const f of lint(x)) {
        const r = (f.field === 'eligibility' ? el : at(f.field === 'documents' ? 'documents' : 'effort'))[f.index]
        if (!r) continue
        flagged++
        if (r.verdict === 'wrong') wrong++
      }
    }
    expect(flagged).toBeGreaterThanOrEqual(10)
    expect(wrong / flagged).toBeGreaterThanOrEqual(0.8)
  })

  test('each check catches its seeded fault', () => {
    const g = { scope: 'countries', countries: ['DE'], label: 'Mecklenburg-Vorpommern' }
    const checks = (x: Partial<LintInput>) => lint({ eligibility: [], documents: [], steps: [], geography: g, ...x }).map((f) => f.check)
    expect(checks({ eligibility: [{ rule: 'The project is located in Mecklenburg-Vorpommern' }] })).toEqual(['restates_geography'])
    expect(checks({ eligibility: [{ rule: 'Runs a project in Rostock, Mecklenburg-Vorpommern, on wetland sites' }] })).toEqual([])
    expect(checks({ eligibility: [{ rule: 'Has no more than 3 awards in a 6-year period' }] })).toEqual(['count_cap'])
    expect(checks({ eligibility: [{ rule: 'Submits no more than one application per round' }] })).toEqual([])
    expect(checks({ eligibility: [{ rule: 'Not a federal, provincial, or state agency' }, { rule: 'Not a federal or state agency' }] })).toEqual(['duplicate'])
    expect(checks({ eligibility: [{ rule: 'Does not request salaries or staff costs' }, { rule: 'Does not request capital or operating costs' }] })).toEqual(['cost_exclusions'])
    expect(checks({ steps: ['Postulación'] })).toEqual(['not_english'])
    expect(checks({ documents: ['Includes an activity for the Fundación Unicaja Volunteer Club'] })).toEqual([])
  })
})
