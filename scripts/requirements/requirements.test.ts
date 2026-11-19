import { describe, expect, test } from 'bun:test'
import type { z } from 'zod'
import { programme as programmeSchema, type Programme, type Source } from '../../src/data/schema'
import { thinFields } from './check'
import { apiWire, chunksOf, reconcile, splitText, toApi, type Wire } from './extract'
import { classifyLink, gather, lowTextPdf, scannedPages, type Doc, type Reader } from './gather'
import { Cache, costOf, Ledger, metered, openaiModel, type Answer, type Question } from './models'
import { emptyWire, run } from './pipeline'
import { queue } from './queue'
import { packQuotes, readsTwoWays, verify } from './verify'
import { evaluate, type Gold, type Scored } from './eval'
import { parseAnswer, promptFor, type ProWire } from './gpt-pro'
import { apply, manifest } from './write'

const base: Programme = programmeSchema.parse({
  id: 'test-grants',
  name: 'Test Nature Grants',
  funder: { name: 'Test Foundation', url: 'https://test.example.org/' },
  administered_by: null,
  parent: null,
  url: 'https://test.example.org/grants',
  summary: 'Grants for community groups restoring wetlands, in our own words for the test.',
  approaches: ['wetlands'],
  applicant_types: ['ngo'],
  geography: { scope: 'global' },
  access: 'direct',
  window: 'rolling',
  amount: null,
  co_finance_required: null,
  reporting: null,
  calls: [],
  evidence: {
    applicant_types: { source_url: 'https://test.example.org/grants', quote: 'Registered charities may apply.', checked_at: '2026-11-01', method: 'page' },
    geography: { source_url: 'https://test.example.org/grants', quote: 'Projects anywhere in the world.', checked_at: '2026-11-01', method: 'page' },
    access: { source_url: 'https://test.example.org/grants', quote: 'Apply online through our portal.', checked_at: '2026-11-01', method: 'page' },
    window: { source_url: 'https://test.example.org/grants', quote: 'Apply at any time of year.', checked_at: '2026-11-01', method: 'page' },
  },
  checked_at: '2026-11-01',
})

const PAGE = `<html><body><main><h1>Test Nature Grants</h1><p>Registered charities may apply. Projects anywhere in the world. Apply online through our portal. Apply at any time of year.</p>
<p>We fund community groups that restore wetlands, rivers and the wildlife that depends on them, and we work with local people to protect the places they care about for the long term.</p>
<p>Read the <a href="/guidelines.pdf">programme guidelines</a> before you apply. <a href="/news">Latest news</a></p></main></body></html>`
const GUIDE = `Test Nature Grants guidelines. Applicants must have been operating for at least three years. Applicants must have an annual income between €50.000 and €500.000.
You must submit your latest audited accounts and a letter of support from the landowner. Stage one is a short concept note. Shortlisted applicants are invited to submit a full proposal by 8 January 2027.
Applicants must provide at least 20% of the project cost as match funding. Grantees submit a final report within three months of the project end. Strong applications show community involvement.`

const doc = (ref: string, text: string, url = `https://test.example.org/${ref}`): Doc => ({ ref, url, final_url: url, from: null, anchor: null, depth: 0, pdf: false, text, pages: null, selected: null, links: [], hash: ref, low_text: false })

const fakeReader =
  (pages: Record<string, string | null>): Reader =>
  async (url) => {
    const body = pages[url]
    if (body === undefined) return { ok: false, kind: 'http', message: 'HTTP 404' }
    if (body === null) return { ok: false, kind: 'network', message: 'reset' }
    // The fake serves the guidelines as HTML; gather treats it like any linked document.
    return { ok: true, finalUrl: url, pdf: false, html: body.startsWith('<') ? body : `<html><body><p>${body}</p></body></html>`, bytes: new Uint8Array() }
  }

const goodWire = (): Wire => ({
  ...emptyWire(),
  eligibility: {
    status: 'stated',
    items: [
      { rule: 'Operating for at least 3 years', kind: 'track_record', doc: 'D2', quote: 'Applicants must have been operating for at least three years.', min_years: 3, revenue: null, request_cap: null },
      { rule: 'Yearly income of €50,000 to €500,000', kind: 'finances', doc: 'D2', quote: 'Applicants must have an annual income between €50.000 and €500.000.', min_years: null, revenue: { currency: 'EUR', min: 50000, max: 500000, basis: 'revenue', average_years: null }, request_cap: null },
    ],
  },
  documents: {
    status: 'stated',
    items: [
      { item: 'Latest audited accounts', doc: 'D2', quote: 'You must submit your latest audited accounts' },
      { item: 'Letter of support from the landowner', doc: 'D2', quote: 'a letter of support from the landowner' },
    ],
  },
  effort: {
    status: 'stated',
    steps: [
      { step: 'Concept note', due: null, doc: 'D2', quote: 'Stage one is a short concept note.' },
      { step: 'Full proposal, if invited', due: '2027-01-08', doc: 'D2', quote: 'Shortlisted applicants are invited to submit a full proposal by 8 January 2027.' },
    ],
    more_after: false,
  },
  co_finance: { status: 'stated', required: true, doc: 'D2', quote: 'Applicants must provide at least 20% of the project cost as match funding.', min_share: 20, ratio: null, min_amount: null, in_kind: null, applies_to: null, detail_doc: null, detail_quote: null },
  after_award: { status: 'stated', items: [{ duty: 'reports', reports: 'final', doc: 'D2', quote: 'Grantees submit a final report within three months of the project end.' }] },
})

/** A model that answers from a queue, recording what it was asked. */
const fakeAsk = (answers: ((Wire & { unresolved?: string[] }) | { wire: Wire; missing: string[] })[]) => {
  const asked: string[] = []
  const ask = async <T,>(_id: string, _system: string, user: string, schema: z.ZodType<T>): Promise<T> => {
    asked.push(user)
    const a = answers.shift()
    if (!a) throw new Error('fake model has no more answers')
    return schema.parse({ unresolved: ('unresolved' in a && a.unresolved) || [], ...('wire' in a ? toApi(a.wire, a.missing) : toApi(a)) })
  }
  return { ask, asked }
}

/** A Jev that answers every Noul with `yes` unless a rule matches the question, and every Choice with the expected option. */
const fakeJev = (rules: { match: RegExp; p: number }[] = [], yes = 0.1) => {
  const calls: Record<string, Question>[] = []
  const ask = async (_id: string, _state: unknown, qs: Record<string, Question>) => {
    calls.push(qs)
    const out: Record<string, Answer> = {}
    for (const [k, q] of Object.entries(qs)) {
      const text = JSON.stringify(q.instructions)
      if (q.type === 'choice') {
        const pick = k.startsWith('kind') ? (k === 'kind1' ? 'finances' : 'track_record') : 'final'
        out[k] = { type: 'choice', choice: pick, confidence: 0.9, probabilities: { [pick]: 0.9 } }
        continue
      }
      const rule = rules.find((r) => r.match.test(k) || r.match.test(text))
      // Questions phrased "is it right" (first step, due, link, about, required) answer yes by default.
      const positive = /^(first|due|step|typed|cf_|duty|l\d|about|v$)/.test(k) || /Would following this link/.test(text)
      out[k] = { type: 'noul', noul: rule ? rule.p : positive ? 0.9 : yes }
    }
    return out
  }
  return { ask, calls }
}

describe('extract: chunks', () => {
  test('a long text splits into overlapping pieces that cover every character', () => {
    const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} about grants.`).join(' ')
    const parts = splitText(text, 2000, 200)
    expect(parts.length).toBeGreaterThan(5)
    expect(parts.every((p) => p.length <= 2000)).toBe(true)
    expect(text.startsWith(parts[0]!)).toBe(true)
    expect(text.endsWith(parts.at(-1)!)).toBe(true)
    for (let i = 1; i < parts.length; i++) expect(parts[i - 1]!.endsWith(parts[i]!.slice(0, 200))).toBe(true)
  })
  test('all text in one prompt when it fits, chunks naming their document when not', () => {
    const docs = [doc('D1', 'a'.repeat(500)), doc('D2', 'b'.repeat(500))]
    expect(chunksOf(docs)).toHaveLength(1)
    const many = chunksOf([doc('D1', 'a '.repeat(30_000)), doc('D2', 'b '.repeat(30_000))], 50_000, 20_000)
    expect(many.length).toBeGreaterThan(2)
    expect(many.every((c) => c.text.startsWith('=== D'))).toBe(true)
    expect(many.reduce((a, c) => a + c.text.length, 0)).toBeGreaterThan(120_000)
  })
  test('reconcile unites items and keeps disagreeing yes/no answers as a conflict', () => {
    const a = goodWire()
    const b = goodWire()
    b.eligibility.items = [{ ...b.eligibility.items[0]!, quote: 'Applicants must have been operating for at least three years.' }, { rule: 'Not a government body', kind: 'legal', doc: 'D1', quote: 'Government bodies may not apply here.', min_years: null, revenue: null, request_cap: null }]
    b.co_finance = { ...b.co_finance, required: false }
    const r = reconcile([a, b])
    expect(r.merged.eligibility.items.map((i) => i.rule)).toEqual(['Operating for at least 3 years', 'Yearly income of €50,000 to €500,000', 'Not a government body'])
    expect(r.conflicts).toEqual(['co_finance'])
  })
})

describe('verify', () => {
  const docs = [doc('D1', 'Test Nature Grants. Registered charities may apply.'), doc('D2', GUIDE)]
  test('keeps items whose quotes are on their documents, with typed values their quotes state', () => {
    const { facts, flags } = verify(goodWire(), docs)
    expect(flags).toEqual([])
    expect(facts.eligibility.map((e) => [e.kind, e.min_years, e.revenue?.max])).toEqual([['track_record', 3, undefined], ['finances', undefined, 500000]])
    expect(facts.effort?.steps.map((s) => s.due)).toEqual([null, '2027-01-08'])
    expect(facts.co_finance).toMatchObject({ min_share: 20 })
    expect(facts.after_award).toMatchObject([{ duty: 'reports', reports: 'final' }])
  })
  test('rejects a quote on no document, and finds one the model misnumbered', () => {
    const w = goodWire()
    w.eligibility.items[0]!.quote = 'Applicants must have operated for five years.'
    w.documents.items[0]!.doc = 'D1'
    const { facts, flags } = verify(w, docs)
    expect(flags.map((f) => [f.field, f.why])).toEqual([['eligibility', 'the quote is not on any gathered document']])
    expect(facts.documents[0]!.q.doc).toBe('D2')
  })
  test('drops a typed number the quote does not state, keeping the rule', () => {
    const w = goodWire()
    w.eligibility.items[0]!.min_years = 5
    const { facts, notes } = verify(w, docs)
    expect(facts.eligibility[0]!.min_years).toBeUndefined()
    expect(facts.eligibility[0]!.rule).toBe('Operating for at least 3 years')
    expect(notes.some((n) => n.includes('min_years dropped'))).toBe(true)
  })
  test('a due date its quote does not state whole is left undated; a hole in the steps rejects the field', () => {
    const w = goodWire()
    w.effort.steps[1]!.due = '2027-01-09'
    expect(verify(w, docs).facts.effort?.steps[1]!.due).toBeNull()
    w.effort.steps[0]!.quote = 'A concept note is not needed.'
    const v = verify(w, docs)
    expect(v.facts.effort).toBeNull()
    expect(v.flags[0]!.field).toBe('effort')
  })
  test('a numeric date that reads two ways is flagged', () => {
    expect(readsTwoWays('Deadline 04/05/2027', '2027-05-04')).toBe(true)
    expect(readsTwoWays('Deadline 24/05/2027', '2027-05-24')).toBe(false)
    expect(readsTwoWays('Deadline 4 May 2027', '2027-05-04')).toBe(false)
    // Its order stated beside it settles it.
    expect(readsTwoWays('Deadline 04/05/2027 (DD/MM/YYYY)', '2027-05-04')).toBe(false)
    // verify flags it for a person rather than leaving it silently undated.
    const w = goodWire()
    w.effort.steps[1]!.due = '2027-05-04'
    w.effort.steps[1]!.quote = 'Deadline 04/05/2027'
    const v = verify(w, [{ ...docs[0]!, text: `${docs[0]!.text} Deadline 04/05/2027` }])
    expect(v.flags.some((f) => f.why.includes('reads two ways'))).toBe(true)
  })
  test('a share its quote does not state is dropped', () => {
    const w = goodWire()
    w.co_finance.min_share = 25
    expect(verify(w, docs).facts.co_finance).toBeNull()
  })
  test('a share read from the most the grant covers is kept (up to 85% of the cost: the applicant brings 15); Jev judges the reading', () => {
    const w = goodWire()
    w.co_finance.quote = 'The grant covers up to 85% of the eligible project cost.'
    w.co_finance.min_share = 15
    const v = verify(w, [{ ...docs[0]!, text: `${docs[0]!.text} The grant covers up to 85% of the eligible project cost.` }])
    expect(v.facts.co_finance?.min_share).toBe(15)
  })
  test('neighbouring quotes pack into one passage to fit the evidence cap', () => {
    const d = doc('D2', GUIDE)
    const qs = [
      { doc: 'D2', quote: 'You must submit your latest audited accounts' },
      { doc: 'D2', quote: 'a letter of support from the landowner' },
      { doc: 'D2', quote: 'Stage one is a short concept note.' },
    ]
    const p = packQuotes([d], qs, 1)
    expect(p?.packed).toHaveLength(1)
    expect(p?.packed[0]!.quote.startsWith('You must submit')).toBe(true)
    expect(p?.covers[0]).toEqual([0, 1, 2])
  })
})

describe('gather', () => {
  test('follows a guidelines link, skips news, and marks coverage complete', async () => {
    const read = fakeReader({ 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': GUIDE })
    const g = await gather(base, { read, sources: [] })
    expect(g.docs.map((d) => d.url)).toEqual(['https://test.example.org/grants', 'https://test.example.org/guidelines.pdf'])
    expect(g.docs[1]!.from).toBe('https://test.example.org/grants')
    expect(g.complete).toBe(true)
  })
  test('a document that will not open marks coverage incomplete', async () => {
    const read = fakeReader({ 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': null })
    const g = await gather(base, { read, sources: [] })
    expect(g.complete).toBe(false)
    expect(g.reasons[0]).toContain('would not open')
  })
  test('the crawl bound marks coverage incomplete', async () => {
    const links = Array.from({ length: 4 }, (_, i) => `<a href="/guide-${i}.pdf">guidelines part ${i}</a>`).join(' ')
    const pages: Record<string, string> = { 'https://test.example.org/grants': `<html><body><p>Test Nature Grants. ${'Words about the programme. '.repeat(20)}</p>${links}</body></html>` }
    for (let i = 0; i < 4; i++) pages[`https://test.example.org/guide-${i}.pdf`] = `Test Nature Grants part ${i}. ${'Rules for applicants. '.repeat(30)}`
    const g = await gather(base, { read: fakeReader(pages), sources: [], bounds: { depth: 2, documents: 2 } })
    expect(g.docs).toHaveLength(3)
    expect(g.complete).toBe(false)
    expect(g.reasons.some((r) => r.includes('crawl bound'))).toBe(true)
  })
  test('links: code follows guidance, skips news and other sites', () => {
    const at = 'https://test.example.org/grants'
    expect(classifyLink({ href: '/guidelines.pdf', text: 'Guidelines', context: '' }, at, base).score).toBe('strong')
    expect(classifyLink({ href: '/news/2026', text: 'Latest news', context: '' }, at, base).score).toBe('skip')
    expect(classifyLink({ href: '/proposals/public-support-grants/', text: 'READ REQUEST FOR PROPOSALS', context: '' }, at, base).score).toBe('strong')
    expect(classifyLink({ href: 'https://other.example.com/', text: 'Partner', context: '' }, at, base).score).toBe('skip')
  })
  test('a PDF with little text per page needs OCR', () => {
    expect(lowTextPdf(['a few words', 'x'])).toBe(true)
    expect(lowTextPdf(['word '.repeat(200)])).toBe(false)
  })
})

describe('pipeline and write', () => {
  const pages = { 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': GUIDE }
  test('a clean read is written, valid, and stamped requirements_checked', async () => {
    const cheap = fakeAsk([goodWire()])
    const jev = fakeJev()
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: cheap.ask, strong: null, jev: jev.ask })
    expect(r.outcomes).toMatchObject({ eligibility: 'stated', documents: 'stated', effort: 'stated', co_finance: 'stated', after_award: 'stated' })
    // Consortium is not stated, and Jev saw no text that states it: not_found, no escalation.
    expect(r.outcomes.consortium).toBe('not_found')
    const { next, manifestBits } = apply(base, r, '2026-11-16', [])
    expect(programmeSchema.safeParse(next).success).toBe(true)
    expect(next.requirements_checked).toBe('2026-11-16')
    expect(next.eligibility?.[0]).toEqual({ rule: 'Operating for at least 3 years', kind: 'track_record', min_years: 3 })
    expect(next.co_finance).toEqual({ min_share: 20 })
    expect(next.effort).toEqual({ steps: ['Concept note', 'Full proposal, if invited'], due: [null, '2027-01-08'] })
    expect(next.evidence.documents).toHaveLength(2)
    expect(manifestBits.written).toContain('eligibility')
  })
  test('a Jev flag goes to the strong model, whose reading replaces the flagged field', async () => {
    const first = goodWire()
    first.eligibility.items.push({ rule: 'Shows community involvement', kind: 'project', doc: 'D2', quote: 'Strong applications show community involvement.', min_years: null, revenue: null, request_cap: null })
    const cheap = fakeAsk([first])
    const strong = fakeAsk([goodWire()])
    const jev = fakeJev([{ match: /^sel2$/, p: 0.95 }])
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: cheap.ask, strong: strong.ask, jev: jev.ask })
    expect(r.escalated).toEqual(['eligibility'])
    expect(r.facts.eligibility).toHaveLength(2)
    expect(r.outcomes.eligibility).toBe('stated')
    expect(strong.asked[0]).toContain('a selection criterion or preference')
  })
  test('without a strong model a flagged rule drops alone: the sound rule is written, the field is partial and the programme unstamped', async () => {
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev([{ match: /^over0$/, p: 0.9 }]).ask })
    expect(r.outcomes.eligibility).toBe('partial')
    const { next, manifestBits } = apply(base, r, '2026-11-16', [])
    expect(next.requirements_checked).toBeUndefined()
    expect(next.eligibility?.map((e) => e.rule)).toEqual(['Yearly income of €50,000 to €500,000'])
    expect(manifestBits.outcomes.eligibility).toBe('partial')
    expect(next.documents).toHaveLength(2)
  })
  test('a flagged step leaves the whole steps field unwritten: a hole in ordered steps misleads', async () => {
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev([{ match: /^step0$/, p: 0.1 }]).ask })
    expect(r.outcomes.effort).toBe('unresolved')
    expect(apply(base, r, '2026-11-16', []).next.effort).toBeUndefined()
  })
  test('polarity is recorded but never flags; overreach needs a high bar', async () => {
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev([{ match: /^pol0$/, p: 0.99 }, { match: /^over1$/, p: 0.7 }]).ask })
    expect(r.judgements.some((j) => j.question === 'polarity' && j.p === 0.99)).toBe(true)
    expect(r.outcomes.eligibility).toBe('stated')
  })
  test('an omission Jev sees sends the field back to extraction', async () => {
    const thin = goodWire()
    thin.documents = { status: 'not_found', items: [] }
    const focused = { ...emptyWire(), documents: goodWire().documents }
    const cheap = fakeAsk([thin, focused])
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: cheap.ask, strong: null, jev: fakeJev([{ match: /^documents$/, p: 0.9 }]).ask })
    expect(cheap.asked[1]).toContain('Report only these fields carefully: documents')
    expect(r.outcomes.documents).toBe('stated')
  })
  test('a reading that contradicts the file keeps the old value and leaves the field open', async () => {
    const before = programmeSchema.parse({ ...base, co_finance_required: false, evidence: { ...base.evidence, co_finance_required: { source_url: 'https://test.example.org/grants', quote: 'No match funding is required.', checked_at: '2026-11-01', method: 'page' } } })
    const r = await run(before, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev().ask })
    const { next, manifestBits } = apply(before, r, '2026-11-16', [])
    expect(next.co_finance_required).toBe(false)
    expect(manifestBits.outcomes.co_finance).toBe('unresolved')
    expect(next.requirements_checked).toBeUndefined()
  })
  test('a new quote outside a source’s selector drops the selector', async () => {
    const src: Source = { id: 'test-grants-1', programme_id: 'test-grants', url: 'https://test.example.org/guidelines.pdf', selector: 'main', hint: null, cycle: 'daily' }
    const r = await run(base, { read: fakeReader(pages), sources: [src], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev().ask })
    const { sources } = apply(base, r, '2026-11-16', [src])
    expect(sources[0]!.selector).toBeNull()
  })
  test('thin fields are the empty ones and a single rule', () => {
    const { facts } = verify(emptyWire(), [])
    expect(thinFields(facts)).toEqual(['eligibility', 'documents', 'effort', 'co_finance', 'consortium', 'after_award'])
  })
})

describe('queue', () => {
  test('never-read programmes with live calls come first; a changed page requeues a read one', () => {
    const live = { ...base, id: 'b-live', calls: [{ id: 'r', label: 'Round', url: base.url, status: 'open' as const, opens: null, deadline: null, evidence: { status: base.evidence.window! } }] }
    const read = { ...base, id: 'a-read', requirements_checked: '2026-10-01' }
    const changed = { ...base, id: 'c-changed', requirements_checked: '2026-10-01' }
    const srcs: Source[] = [{ id: 'c-changed-1', programme_id: 'c-changed', url: base.url, selector: null, hint: null, cycle: 'daily' }]
    const due = queue([base, live, read, changed], srcs, { 'c-changed-1': { source_id: 'c-changed-1', last_change: '2026-11-10' } }, '2026-11-16')
    expect(due.map((d) => d.id)).toEqual(['b-live', 'test-grants', 'c-changed'])
    expect(due[2]!.why).toContain('changed on 2026-11-10')
  })
})

describe('files and schemas', () => {
  test('writing a programme keeps its file’s key order and formatting', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { serialise } = await import('./write')
    const differ: string[] = []
    let n = 0
    for (const f of readdirSync('data/programmes')) {
      const text = readFileSync(`data/programmes/${f}`, 'utf8')
      const { formatJson } = await import('../refresh/json')
      const x = JSON.parse(text)
      // Files in neither house style are rewritten in formatJson's; only the others must round-trip.
      if (formatJson(x) !== text && `${JSON.stringify(x, null, 2)}\n` !== text) continue
      n++
      if (serialise(programmeSchema.parse(x), text) !== text) differ.push(f)
    }
    expect(n).toBeGreaterThan(900)
    expect(differ).toEqual([])
    // A new key lands where the schema puts it.
    const x = JSON.parse(readFileSync('data/programmes/rufford-small-grants.json', 'utf8'))
    const out = JSON.parse(serialise({ ...x, requirements_checked: '2026-11-16' }, readFileSync('data/programmes/rufford-small-grants.json', 'utf8')))
    const keys = Object.keys(out)
    expect(keys.indexOf('requirements_checked')).toBeLessThan(keys.indexOf('calls'))
  })
  test('the answer schema stays inside the structured-output limits (16 unions, 24 optional)', async () => {
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod')
    const { z: zod } = await import('zod')
    const f = zodOutputFormat(apiWire.extend({ unresolved: zod.array(zod.string()) }) as never) as unknown as { schema: unknown }
    let unions = 0
    let optional = 0
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      const o = n as Record<string, unknown>
      if (o.anyOf || Array.isArray(o.type)) unions++
      if (o.properties) optional += Object.keys(o.properties).filter((k) => !((o.required as string[]) ?? []).includes(k)).length
      Object.values(o).forEach(walk)
    }
    walk(f.schema)
    expect(unions).toBeLessThanOrEqual(16)
    expect(optional).toBeLessThanOrEqual(24)
  })
  test('a reading that would drop a fact the file quotes leaves the field open', async () => {
    const before = programmeSchema.parse({
      ...base,
      documents: ['Map of the site'],
      evidence: { ...base.evidence, documents: [{ source_url: 'https://test.example.org/grants', quote: 'Attach a map of the site to your application.', checked_at: '2026-11-01', method: 'page' }] },
    })
    const pages = { 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': GUIDE }
    const r = await run(before, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev().ask })
    const { next, manifestBits } = apply(before, r, '2026-11-16', [])
    expect(next.documents).toEqual(['Map of the site'])
    expect(manifestBits.outcomes.documents).toBe('unresolved')
  })
  test('a Word file is a failed read, not text', async () => {
    const read: Reader = async (url) =>
      url.endsWith('.docx')
        ? { ok: true, finalUrl: url, pdf: false, html: 'PK\x03\x04garbage', bytes: new TextEncoder().encode('PK\x03\x04garbage') }
        : fakeReader({ 'https://test.example.org/grants': PAGE.replace('/guidelines.pdf', '/guidelines.docx') })(url)
    const g = await gather(base, { read, sources: [] })
    expect(g.complete).toBe(false)
    expect(g.failures.map((f) => f.kind)).toContain('unreadable')
  })
})

test('links: the same page in another language is skipped', () => {
  expect(classifyLink({ href: '/pt/faq', text: 'FAQ', context: '' }, 'https://test.example.org/en/grants', base).why).toBe('another language')
  expect(classifyLink({ href: '/en/faq', text: 'FAQ', context: '' }, 'https://test.example.org/en/grants', base).score).toBe('strong')
})

test('gather: a page written with and without its trailing slash is read once', async () => {
  const page = PAGE.replace('<a href="/news">Latest news</a>', '<a href="/faq">FAQ</a> <a href="/faq/">Questions</a>')
  const faq = 'Test Nature Grants questions. Registered charities may apply; individuals may not. '.repeat(5)
  const read = fakeReader({ 'https://test.example.org/grants': page, 'https://test.example.org/guidelines.pdf': GUIDE, 'https://test.example.org/faq': faq, 'https://test.example.org/faq/': faq })
  const g = await gather(base, { read, sources: [] })
  expect(g.docs.filter((d) => d.url.includes('/faq')).length).toBe(1)
})

/** A two-page PDF: page 1 has text, page 2 only a 300 by 300 grey image. Offsets are left for the reader to rebuild. */
function scanPdf(text: string): Uint8Array {
  const img = 'f'.repeat(300 * 300 * 2)
  const content1 = `BT /F1 10 Tf 40 700 Td ${Array(12).fill(`(${text}) Tj 0 -14 Td`).join(' ')} ET`
  const content2 = 'q 300 0 0 300 50 400 cm /Im1 Do Q'
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content1.length} >>\nstream\n${content1}\nendstream`,
    `<< /Length ${content2.length} >>\nstream\n${content2}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width 300 /Height 300 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${img.length + 1} >>\nstream\n${img}>\nendstream`,
  ]
  let out = '%PDF-1.4\n'
  const at: number[] = []
  objs.forEach((o, i) => {
    at.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

describe('gather: coverage it must not claim', () => {
  test('a scanned page inside a readable PDF is found', async () => {
    const pdf = scanPdf('Applicants must be registered charities and must submit audited accounts with the application form.')
    const { pdfPages } = await import('../refresh/fetch')
    const pages = pdfPages(pdf)
    expect(pages.length).toBe(2)
    expect(lowTextPdf(pages)).toBe(false)
    expect(scannedPages(pages, pdf)).toEqual([2])
  })

  test('a relevant link past the crawl depth blocks the stamp', async () => {
    const link = (href: string, words: string) => `<html><body><main><h1>Test Nature Grants</h1><p>${'Test Nature Grants help community groups restore rivers and wetlands. '.repeat(6)}</p><p><a href="${href}">${words}</a></p></main></body></html>`
    const read = fakeReader({
      'https://test.example.org/grants': link('/a', 'Application guide'),
      'https://test.example.org/a': link('/b', 'Eligibility rules'),
      'https://test.example.org/b': link('/c', 'Requirements'),
      'https://test.example.org/c': 'Test Nature Grants requirements. Applicants must have audited accounts.',
    })
    const g = await gather(base, { read, sources: [] })
    expect(g.docs.map((d) => d.url)).not.toContain('https://test.example.org/c')
    expect(g.complete).toBe(false)
    expect(g.reasons.join(' ')).toContain('https://test.example.org/c')
  })

  test('an application portal on another site blocks the stamp and is never read', async () => {
    const page = PAGE.replace('<a href="/news">Latest news</a>', '<a href="https://portal.example.net/apply/123">Apply here</a>')
    const read = fakeReader({ 'https://test.example.org/grants': page, 'https://test.example.org/guidelines.pdf': GUIDE, 'https://portal.example.net/apply/123': 'Test Nature Grants application. Applicants must upload a board resolution.' })
    const g = await gather(base, { read, sources: [], jev: fakeJev().ask })
    expect(g.docs.map((d) => d.url)).not.toContain('https://portal.example.net/apply/123')
    expect(g.complete).toBe(false)
    expect(g.failures.find((f) => f.url === 'https://portal.example.net/apply/123')?.kind).toBe('offsite')
  })

  test('the funder’s own file served through a redirect to a file host is first-party', async () => {
    const page = PAGE.replace('<a href="/news">Latest news</a>', '<a href="/_files/rules.pdf">Grant rules</a>')
    const pages: Record<string, string> = { 'https://test.example.org/grants': page, 'https://test.example.org/guidelines.pdf': GUIDE }
    const rules = 'Grant rules. Applicants must be registered charities with two years of accounts. '.repeat(6)
    const read: Reader = async (url) => {
      if (url === 'https://test.example.org/_files/rules.pdf') return { ok: true, finalUrl: 'https://abc.filesusr.example/ugd/rules.pdf', pdf: false, html: `<html><body><p>${rules}</p></body></html>`, bytes: new Uint8Array() }
      return fakeReader(pages)(url)
    }
    const g = await gather(base, { read, sources: [] })
    expect(g.docs.map((d) => d.url)).toContain('https://test.example.org/_files/rules.pdf')
    expect(g.failures.filter((f) => f.kind === 'offsite')).toEqual([])
  })

  test('a document on another host that names the funder is not used without Jev', async () => {
    const page = PAGE.replace('<a href="/news">Latest news</a>', '<a href="https://guides.example.net/test-nature-grants-guide.pdf">A guide to Test Nature Grants</a>')
    const read = fakeReader({ 'https://test.example.org/grants': page, 'https://test.example.org/guidelines.pdf': GUIDE, 'https://guides.example.net/test-nature-grants-guide.pdf': 'Test Nature Grants: our guide. Applicants must have five years of accounts. '.repeat(6) })
    const g = await gather(base, { read, sources: [] })
    expect(g.docs.map((d) => d.url)).not.toContain('https://guides.example.net/test-nature-grants-guide.pdf')
    expect(g.complete).toBe(false)
  })
})

describe('the stamp: every path that must block it', () => {
  const pages = { 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': GUIDE }
  const stamped = programmeSchema.parse({ ...base, requirements_checked: '2026-01-01' })

  test('a second reading that names an unread rules document blocks the stamp', async () => {
    const thin = goodWire()
    thin.documents = { status: 'not_found', items: [] }
    const cheap = fakeAsk([thin, { wire: { ...emptyWire(), documents: goodWire().documents }, missing: ['Annex 2: eligibility rules'] }])
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: cheap.ask, strong: null, jev: fakeJev([{ match: /^documents$/, p: 0.9 }]).ask })
    expect(r.gathered.complete).toBe(false)
    expect(apply(base, r, '2026-11-16', []).next.requirements_checked).toBeUndefined()
  })

  test('without Jev nothing is stamped', async () => {
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: null })
    expect(apply(base, r, '2026-11-16', []).next.requirements_checked).toBeUndefined()
  })

  test('a reread that cannot finish takes back the old stamp', async () => {
    const r = await run(stamped, { read: fakeReader({ 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': null }), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev().ask })
    const { next, manifestBits } = apply(stamped, r, '2026-11-16', [])
    expect(next.requirements_checked).toBeUndefined()
    expect(manifestBits.notes.join(' ')).toContain('removed')
  })

  test('a duty backed by an unrelated quote is caught by Jev', async () => {
    const w = goodWire()
    w.after_award.items.push({ duty: 'audit', reports: null, doc: 'D2', quote: 'Strong applications show community involvement.' } as never)
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([w]).ask, strong: null, jev: fakeJev([{ match: /^duty1$/, p: 0.05 }]).ask })
    expect(r.outcomes.after_award).toBe('unresolved')
  })

  test('a Jev question left unanswered flags its item', async () => {
    const jev = fakeJev()
    const ask: typeof jev.ask = async (id, state, qs) => {
      const a = await jev.ask(id, state, qs)
      delete a.first0
      return a
    }
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: ask })
    expect(r.outcomes.documents).toBe('partial')
    expect(r.facts.documents.map((d) => d.item)).toEqual(['Letter of support from the landowner'])
  })

  test('two documents named in one passage are two facts: dropping one leaves the field open', async () => {
    const before = programmeSchema.parse({
      ...base,
      documents: ['Latest audited accounts', 'Letter of support from the landowner'],
      evidence: { ...base.evidence, documents: [{ source_url: 'https://test.example.org/guidelines.pdf', quote: 'You must submit your latest audited accounts and a letter of support from the landowner.', checked_at: '2026-11-01', method: 'page' }] },
    })
    const w = goodWire()
    w.documents.items = [{ item: 'Latest audited accounts', doc: 'D2', quote: 'You must submit your latest audited accounts and a letter of support from the landowner.' }]
    const r = await run(before, { read: fakeReader(pages), sources: [], cheap: fakeAsk([w]).ask, strong: null, jev: fakeJev().ask })
    const { next, manifestBits } = apply(before, r, '2026-11-16', [])
    expect(next.documents).toEqual(['Latest audited accounts', 'Letter of support from the landowner'])
    expect(manifestBits.outcomes.documents).toBe('unresolved')
    expect(next.requirements_checked).toBeUndefined()
  })

  test('a document list spread over a page keeps every item, one quote each', async () => {
    const guide = `${GUIDE} ${'Filler about the programme and its history. '.repeat(30)} Include a site map. ${'More filler text about wetlands. '.repeat(30)} Include a CV for the project lead. ${'Closing words about rivers. '.repeat(30)} Include a land title.`
    const w = goodWire()
    w.documents.items.push({ item: 'Site map', doc: 'D2', quote: 'Include a site map.' }, { item: 'CV of the project lead', doc: 'D2', quote: 'Include a CV for the project lead.' }, { item: 'Land title', doc: 'D2', quote: 'Include a land title.' })
    const r = await run(base, { read: fakeReader({ ...pages, 'https://test.example.org/guidelines.pdf': guide }), sources: [], cheap: fakeAsk([w]).ask, strong: null, jev: fakeJev().ask })
    const { next, manifestBits } = apply(base, r, '2026-11-16', [])
    expect(manifestBits.outcomes.documents).toBe('stated')
    expect(next.documents).toHaveLength(5)
    expect(next.evidence.documents!.length).toBeGreaterThan(3)
    expect(next.evidence.documents!.length).toBeLessThanOrEqual(5)
  })

  test('a newly cited page joins the watch list, and only this programme’s selector changes', async () => {
    const mine: Source = { id: 'test-grants-1', programme_id: 'test-grants', url: 'https://test.example.org/grants', selector: null, hint: null, cycle: 'daily' }
    const other: Source = { id: 'other-1', programme_id: 'other', url: 'https://test.example.org/guidelines.pdf', selector: 'main', hint: null, cycle: 'daily' }
    const r = await run(base, { read: fakeReader(pages), sources: [mine, other], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev().ask })
    const { sources } = apply(base, r, '2026-11-16', [mine, other])
    expect(sources.find((s) => s.id === 'other-1')!.selector).toBe('main')
    expect(sources.find((s) => s.programme_id === 'test-grants' && s.url === 'https://test.example.org/guidelines.pdf')).toBeTruthy()
  })
})

describe('reconcile: same item, not same passage', () => {
  test('two documents named in one passage stay two; one document read twice merges', () => {
    const a = goodWire()
    const b = goodWire()
    const r = reconcile([a, b])
    expect(r.merged.documents.items.map((d) => d.item)).toEqual(['Latest audited accounts', 'Letter of support from the landowner'])
    const c = goodWire()
    c.documents.items = [{ item: 'Audited accounts', doc: 'D2', quote: 'You must submit your latest audited accounts and a letter of support from the landowner' }, { item: 'Landowner letter', doc: 'D2', quote: 'You must submit your latest audited accounts and a letter of support from the landowner' }]
    expect(reconcile([c, emptyWire()]).merged.documents.items).toHaveLength(2)
  })
  test('yearly and quarterly reporting are a conflict', () => {
    const a = goodWire()
    const b = goodWire()
    a.after_award.items = [{ duty: 'reports', reports: 'yearly', doc: 'D2', quote: 'Grantees report every year.' }] as never
    b.after_award.items = [{ duty: 'reports', reports: 'quarterly', doc: 'D2', quote: 'Grantees report each quarter.' }] as never
    expect(reconcile([a, b]).conflicts).toContain('after_award')
  })
  test('two different co-funding shares are a conflict', () => {
    const a = goodWire()
    const b = goodWire()
    b.co_finance = { ...b.co_finance, min_share: 50 }
    expect(reconcile([a, b]).conflicts).toContain('co_finance')
  })
})

describe('spend', () => {
  test('a paid call that fails still counts, and the cap stops the next call before it is sent', async () => {
    const { claudeModel } = await import('./models')
    let sent = 0
    const client = {
      messages: {
        stream: () => {
          sent++
          return { finalMessage: async () => ({ stop_reason: 'max_tokens', content: [], usage: { input_tokens: 100_000, output_tokens: 32_000 } }) }
        },
      },
    }
    const ledger = new Ledger(5)
    const ask = metered(claudeModel('claude-opus-5-5', {}, client as never), ledger, new Cache(null), 't')
    for (let i = 0; i < 3; i++) await ask('x', 'system', 'user', apiWire).catch(() => {})
    expect(ledger.total).toBeCloseTo(3 * (0.4 + 0.64), 5)
    expect(sent).toBe(3)
    const big = new Ledger(1.1)
    const ask2 = metered(claudeModel('claude-opus-5-5', {}, client as never), big, new Cache(null), 't')
    await ask2('x', 'system', 'user', apiWire).catch(() => {})
    await expect(ask2('x', 'system', 'user2', apiWire)).rejects.toThrow('spend cap')
    expect(sent).toBe(4)
  })
})

describe('eval: what visitors would see, matched one to one', () => {
  const q = 'Applicants must submit a registration certificate and audited accounts for the last two years.'
  const gold: Gold = {
    id: 'g', filled_by: 'test', checked_by_person: false, documents_expected: [{ url: 'https://x.org/call', why: 'call' }], coverage_complete: true,
    eligibility: [], effort: [], co_finance_required: null, co_finance: null, consortium_required: null, after_award: [], notes: '',
    documents: [{ item: 'registration certificate', quote: q }, { item: 'audited accounts', quote: q }],
  }
  const result = (written: Scored['written_items'], stamped: boolean, id = 'g') =>
    ({
      id, facts: { eligibility: [], documents: [], effort: null, co_finance_required: null, consortium_required: null, after_award: [] }, judgements: [],
      gathered: { docs: [{ url: 'https://x.org/call', final_url: 'https://x.org/call' }], failures: [] },
      manifest: { requirements_checked: stamped, outcomes: {} }, written_items: written,
    }) as unknown as Scored

  test('one written item standing for two requirements in one passage is one hit, and its stamp is false', () => {
    const r = evaluate([result({ documents: [{ name: 'registration certificate', quote: q }] }, true)], new Map([['g', gold]]), {})
    expect(r.item_recall.documents).toBe(50)
    expect(r.false_stamps.map((f) => f.id)).toEqual(['g'])
  })
  test('a requested gold programme with no result counts every item as missed', () => {
    const r = evaluate([], new Map([['g', gold]]), {})
    expect(r.failed).toEqual(['g'])
    expect(r.item_recall.documents).toBe(0)
    expect(r.discovery_recall).toBe(0)
  })
  test('only written items count: facts the write step dropped are omissions', () => {
    const r = evaluate([result({}, false)], new Map([['g', gold]]), {})
    expect(r.omissions).toHaveLength(2)
    expect(r.stamp_yield.pct).toBe(0)
    expect(r.stamp_yield.right).toBe(0)
  })
})

describe('eval: a real run scored against its gold set', () => {
  const pages = { 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': GUIDE }
  const w = goodWire()
  const gold = (): Gold => ({
    id: base.id, filled_by: 'test', checked_by_person: false, coverage_complete: true, notes: '',
    documents_expected: [{ url: 'https://test.example.org/grants', why: 'call' }, { url: 'https://test.example.org/guidelines.pdf', why: 'guidelines' }],
    eligibility: [
      { rule: 'Operating for at least 3 years', kind: 'track_record', min_years: 3, quote: w.eligibility.items[0]!.quote },
      { rule: 'Yearly income of €50,000 to €500,000', kind: 'finances', revenue: { currency: 'EUR', min: 50000, max: 500000, basis: 'revenue' }, quote: w.eligibility.items[1]!.quote },
    ],
    documents: w.documents.items.map((d) => ({ item: d.item, quote: d.quote })),
    effort: w.effort.steps.map((s) => ({ step: s.step, due: s.due, quote: s.quote })),
    co_finance_required: { value: true, quote: w.co_finance.quote! },
    co_finance: { min_share: 20 },
    consortium_required: null,
    after_award: [{ duty: 'reports', reports: 'final', quote: w.after_award.items[0]!.quote }],
  })
  const scored = async () => {
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev().ask })
    const a = apply(base, r, '2026-11-16', [])
    return { ...r, manifest: manifest(r, '2026-11-16', a.manifestBits, ['fake'], 0.01), written_items: a.items, co_finance_written: a.next.co_finance ?? null } as Scored
  }
  test('a right read scores full marks, a right stamp, and every Jev judgement gets a label', async () => {
    const s = await scored()
    const e = evaluate([s], new Map([[base.id, gold()]]), { [base.id]: 0.01 })
    expect(e.all_items).toEqual({ recall: 100, precision: 100 })
    expect(e.value_misses).toEqual([])
    expect(e.false_stamps).toEqual([])
    expect(e.stamp_yield.right).toBe(1)
    expect(e.jev_unlabelled).toEqual([])
    expect(Object.keys(e.jev)).toEqual(expect.arrayContaining(['selection', 'kind', 'typed', 'first_step', 'step', 'due', 'required', 'co_finance', 'duty', 'reports']))
    // Every judgement is right against this gold set: nothing for Jev to catch.
    for (const [q, t] of Object.entries(e.jev)) if (q !== "omission") expect([q, t.positives]).toEqual([q, 0])
  })
  test('a ratio and the share it equals score as the same co-funding (1:4 is 20%)', async () => {
    const s = await scored()
    const g = gold()
    g.co_finance = { ratio: '1:4' }
    const e = evaluate([s], new Map([[base.id, g]]), {})
    expect(e.value_misses).toEqual([])
    g.co_finance = { ratio: '1:3' }
    expect(evaluate([s], new Map([[base.id, g]]), {}).value_misses).toEqual([`${base.id}: co_finance.share 20, gold 25`])
  })
  test('a wrong due date, kind, threshold or co-funding share is a value miss, a false stamp, and a Jev positive', async () => {
    const s = await scored()
    const g = gold()
    g.effort[1]!.due = '2027-01-15'
    g.eligibility[0]!.kind = 'legal'
    g.eligibility[0]!.min_years = 2
    g.co_finance = { min_share: 25 }
    const e = evaluate([s], new Map([[base.id, g]]), {})
    expect(e.value_misses).toHaveLength(4)
    expect(e.false_stamps[0]?.why).toContain('4 written values differ')
    expect(e.stamp_yield.right).toBe(0)
    for (const q of ['due', 'kind', 'typed', 'co_finance']) expect(e.jev[q]?.positives).toBe(1)
  })
  test('a wrong yes/no is a miss, and an item the gold set lacks is an extra on the stamp', async () => {
    const s = await scored()
    const g = gold()
    g.co_finance_required!.value = false
    g.co_finance = null
    g.documents.pop()
    const e = evaluate([s], new Map([[base.id, g]]), {})
    expect(e.yes_no.wrong).toBe(1)
    expect(e.stamped_extras).toEqual([{ id: base.id, n: 1 }])
    expect(e.jev.required?.positives).toBe(1)
    expect(e.jev.first_step?.positives).toBe(1)
  })
})

describe('OpenAI models', () => {
  const real = globalThis.fetch
  const stub = (body: unknown) => {
    const sent: { url: string; body: Record<string, unknown> }[] = []
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) })
      return new Response(JSON.stringify(body), { status: 200 })
    }) as never
    return sent
  }
  const usage = { input_tokens: 300_000, output_tokens: 10_000, input_tokens_details: { cached_tokens: 100_000 } }
  test('the schema goes out strict and closed, and the answer is parsed and priced with cached input', async () => {
    const answer = toApi(goodWire())
    const sent = stub({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }], usage })
    try {
      const m = openaiModel('gpt-5.6-luna', { effort: 'medium' }, 'test-key')!
      const r = await m.json('system', 'user', apiWire)
      expect(r.value.documents.items).toHaveLength(2)
      const fmt = (sent[0]!.body.text as { format: { strict: boolean; schema: Record<string, unknown> } }).format
      expect(fmt.strict).toBe(true)
      expect(fmt.schema.$schema).toBeUndefined()
      expect(fmt.schema.additionalProperties).toBe(false)
      expect(sent[0]!.body.reasoning).toEqual({ effort: 'medium' })
      // Over 272K input: the long card, with 100K of it cached.
      expect(costOf('gpt-5.6-luna', r.usage)).toBeCloseTo((200_000 * 0.4 + 100_000 * 0.04 + 10_000 * 1.8) / 1e6, 8)
    } finally {
      globalThis.fetch = real
    }
  })
  test('a refusal or an answer cut short is a failed call whose tokens are still counted', async () => {
    try {
      for (const body of [
        { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], usage },
        { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage },
      ]) {
        stub(body)
        const ledger = new Ledger(100)
        const ask = metered(openaiModel('gpt-5.6-sol', {}, 'test-key')!, ledger, new Cache(null), 't')
        await expect(ask('x', 'system', 'user', apiWire)).rejects.toThrow(/declined|stopped early/)
        expect(ledger.total).toBeGreaterThan(0)
      }
    } finally {
      globalThis.fetch = real
    }
  })
  test('no key, no model', () => {
    expect(openaiModel('gpt-5.6-luna', {}, '')).toBeNull()
  })
})

describe('escalation keeps what nothing faulted', () => {
  const pages = { 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': GUIDE }
  test('a sound first-reading rule the strong reading drops is kept; the flagged one goes; the strong model sees the first items', async () => {
    const first = goodWire()
    first.eligibility.items.push({ rule: 'Shows community involvement', kind: 'project', doc: 'D2', quote: 'Strong applications show community involvement.', min_years: null, revenue: null, request_cap: null })
    const narrow = goodWire()
    narrow.eligibility.items = [narrow.eligibility.items[0]!]
    const strong = fakeAsk([narrow])
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([first]).ask, strong: strong.ask, jev: fakeJev([{ match: /^sel2$/, p: 0.95 }]).ask })
    expect(r.escalated).toEqual(['eligibility'])
    expect(r.facts.eligibility.map((e) => e.rule)).toEqual(['Operating for at least 3 years', 'Yearly income of €50,000 to €500,000'])
    expect(r.notes.some((n) => n.includes('kept 1 first-reading item'))).toBe(true)
    expect(strong.asked[0]).toContain('"Yearly income of €50,000 to €500,000"')
    expect(strong.asked[0]).toContain('keep the first reader')
  })
  test('a field the strong model leaves unresolved keeps the sound rules of both readings and blocks the stamp', async () => {
    const first = goodWire()
    first.eligibility.items.push({ rule: 'Shows community involvement', kind: 'project', doc: 'D2', quote: 'Strong applications show community involvement.', min_years: null, revenue: null, request_cap: null })
    const narrow = { ...goodWire(), unresolved: ['eligibility'] }
    narrow.eligibility.items = [narrow.eligibility.items[0]!]
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([first]).ask, strong: fakeAsk([narrow]).ask, jev: fakeJev([{ match: /^sel2$/, p: 0.95 }]).ask })
    expect(r.outcomes.eligibility).toBe('partial')
    expect(r.facts.eligibility.map((e) => e.rule)).toEqual(['Operating for at least 3 years', 'Yearly income of €50,000 to €500,000'])
    expect(apply(base, r, '2026-11-16', []).next.requirements_checked).toBeUndefined()
  })
})

describe('gold set', () => {
  const index = JSON.parse(require('node:fs').readFileSync('tests/fixtures/requirements/index.json', 'utf8')) as { programmes: { id: string; split: string }[] }
  test('every programme is in a split run.ts and eval.ts select on', () => {
    expect(index.programmes.filter((p) => p.split !== 'tune' && p.split !== 'held')).toEqual([])
    expect(index.programmes.filter((p) => p.split === 'tune').length).toBe(40)
    expect(index.programmes.filter((p) => p.split === 'held').length).toBe(20)
  })
  test('every fixture parses as gold with quotes', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const p of index.programmes) {
      const file = `tests/fixtures/requirements/${p.id}.json`
      if (!fs.existsSync(file)) continue
      const g = JSON.parse(fs.readFileSync(file, 'utf8')) as Gold
      expect(g.id).toBe(p.id)
      for (const x of [...g.eligibility, ...g.documents, ...g.effort, ...g.after_award]) expect(x.quote.length).toBeGreaterThan(3)
    }
  })
})

describe('Word files and file hosts', () => {
  const { docxText, isDocx } = require('../data/docx') as typeof import('../data/docx')
  const { normalise } = require('../../src/data/text') as typeof import('../../src/data/text')
  const word = new Uint8Array(require('node:fs').readFileSync('tests/fixtures/docx/rules.docx'))

  test('a .docx reads as its paragraphs, without field codes, deleted text or a text box twice', () => {
    expect(isDocx(word)).toBe(true)
    expect(isDocx(new TextEncoder().encode('%PDF-1.7'))).toBe(false)
    const text = normalise(docxText(word))
    expect(text).toContain('Applicants must be registered charities with two years of accounts.')
    expect(text).toContain('Apply online by 1 March.')
    expect(text).not.toContain('HYPERLINK')
    expect(text).not.toContain('by post')
    expect(text).not.toContain('-28575')
    expect(text.split('Budget & match: 20%').length).toBe(2)
    expect(text).toContain('Cap €50,000')
  })

  test('the funder’s Word file on its file host, linked only as “the Application”, is read as first-party', async () => {
    const page = PAGE.replace('<a href="/news">Latest news</a>', '<a href="https://test.widen.net/s/abc123/rules-2027">Download the Application</a>')
    const pages: Record<string, string> = { 'https://test.example.org/grants': page, 'https://test.example.org/guidelines.pdf': GUIDE }
    const read: Reader = async (url) => {
      if (url === 'https://test.widen.net/s/abc123/rules-2027') return { ok: true, finalUrl: 'https://cf-store.widencdn.net/test/a/rules.docx', pdf: false, html: new TextDecoder().decode(word), bytes: word }
      return fakeReader(pages)(url)
    }
    const g = await gather(base, { read, sources: [] })
    const d = g.docs.find((x) => x.url === 'https://test.widen.net/s/abc123/rules-2027')
    expect(d?.text).toContain('Applicants must be registered charities with two years of accounts.')
    expect(g.failures).toEqual([])
  })

  test('two companies under the same country suffix are not one site', () => {
    const c = classifyLink({ href: 'https://other.co.uk/about', text: 'About us', context: '' }, 'https://funder.co.uk/grants', { name: 'Funder Grants', url: 'https://funder.co.uk/grants' })
    expect(c.why).toBe('another site')
  })
})

test('an href’s entities are decoded, so a query string keeps its parameters', async () => {
  const { linksFrom } = await import('./gather')
  const links = await linksFrom('<p><a href="/rfp.docx?rev=1&amp;hash=AB">Download the RFP</a></p>')
  expect(links[0]?.href).toBe('/rfp.docx?rev=1&hash=AB')
})

describe('GPT Pro as the first reader', () => {
  const GUIDE_URL = 'https://test.example.org/rules/guidelines'
  // The guidelines sit where our crawl doesn't reach (no link from the programme page); GPT Pro found them.
  const pages = { 'https://test.example.org/grants': PAGE.replace('<a href="/guidelines.pdf">programme guidelines</a>', 'programme guidelines'), [GUIDE_URL]: GUIDE }
  /** goodWire with each quote's URL where the cheap model writes D2. */
  const proAnswer = (w = goodWire(), read = [GUIDE_URL]): ProWire => {
    const api = toApi(w)
    const url = (d: string) => (d === 'D2' ? GUIDE_URL : d)
    return {
      ...api,
      eligibility: { ...api.eligibility, items: api.eligibility.items.map((i) => ({ ...i, doc: url(i.doc) })) },
      documents: { ...api.documents, items: api.documents.items.map((i) => ({ ...i, doc: url(i.doc) })) },
      effort: { ...api.effort, steps: api.effort.steps.map((i) => ({ ...i, doc: url(i.doc) })) },
      after_award: { ...api.after_award, items: api.after_award.items.map((i) => ({ ...i, doc: url(i.doc) })) },
      co_finance: { ...api.co_finance, doc: url(api.co_finance.doc) },
      read,
    }
  }
  const noCheap = fakeAsk([]).ask

  test('its reading replaces the cheap model, and every quote is checked on our own copy of the page it cites', async () => {
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: noCheap, strong: null, jev: fakeJev().ask, answers: () => proAnswer() })
    expect(r.gathered.docs.map((d) => d.url)).toEqual(['https://test.example.org/grants', GUIDE_URL])
    expect(r.gathered.docs[1]!.from).toBe('first reader')
    expect(r.outcomes).toMatchObject({ eligibility: 'stated', documents: 'stated', effort: 'stated', co_finance: 'stated', after_award: 'stated' })
    expect(r.facts.eligibility[0]!.q.doc).toBe('D2')
    const { next } = apply(base, r, '2026-11-17', [])
    expect(next.requirements_checked).toBe('2026-11-17')
    expect(next.evidence.documents?.[0]?.source_url).toBe(GUIDE_URL)
  })
  test('a quote not on our copy of its page drops, and the field goes no further than what verifies', async () => {
    const w = goodWire()
    w.documents.items[0]!.quote = 'You must submit your audited accounts for five years'
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: noCheap, strong: null, jev: fakeJev().ask, answers: () => proAnswer(w) })
    expect(r.facts.documents.map((d) => d.item)).toEqual(['Letter of support from the landowner'])
    expect(r.outcomes.documents).toBe('partial')
  })
  test('a page it cites that we cannot open blocks the stamp', async () => {
    const r = await run(base, { read: fakeReader({ ...pages, 'https://test.example.org/faq': null }), sources: [], cheap: noCheap, strong: null, jev: fakeJev().ask, answers: () => proAnswer(goodWire(), [GUIDE_URL, 'https://test.example.org/faq']) })
    expect(r.gathered.complete).toBe(false)
    expect(apply(base, r, '2026-11-17', []).next.requirements_checked).toBeUndefined()
  })
  test('a programme without a stored answer reads with the cheap model as before', async () => {
    const cheap = fakeAsk([goodWire()])
    const r = await run(base, { read: fakeReader({ 'https://test.example.org/grants': PAGE, 'https://test.example.org/guidelines.pdf': GUIDE }), sources: [], cheap: cheap.ask, strong: null, jev: fakeJev().ask, answers: () => null })
    expect(cheap.asked).toHaveLength(1)
    expect(r.outcomes.eligibility).toBe('stated')
  })
  test('the answer parses from its json block; the prompt asks for URLs, not D1', () => {
    const a = proAnswer()
    expect(parseAnswer(`Here it is:\n\`\`\`json\n${JSON.stringify(a)}\n\`\`\``).read).toEqual([GUIDE_URL])
    const prompt = promptFor(base)
    expect(prompt).not.toContain('D1')
    expect(prompt).toContain('https://test.example.org/grants')
  })
})
