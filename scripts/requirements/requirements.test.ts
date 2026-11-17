import { describe, expect, test } from 'bun:test'
import type { z } from 'zod'
import { programme as programmeSchema, type Programme, type Source } from '../../src/data/schema'
import { thinFields } from './check'
import { apiWire, chunksOf, reconcile, splitText, toApi, type Wire } from './extract'
import { classifyLink, gather, lowTextPdf, type Doc, type Reader } from './gather'
import type { Answer, Question } from './models'
import { emptyWire, run } from './pipeline'
import { queue } from './queue'
import { packQuotes, readsTwoWays, verify } from './verify'
import { apply } from './write'

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
const fakeAsk = (answers: Wire[]) => {
  const asked: string[] = []
  const ask = async <T,>(_id: string, _system: string, user: string, schema: z.ZodType<T>): Promise<T> => {
    asked.push(user)
    const a = answers.shift()
    if (!a) throw new Error('fake model has no more answers')
    return schema.parse({ unresolved: [], ...toApi(a) })
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
      const positive = /^(first|due|l\d|about|v$)/.test(k) || /Would following this link/.test(text)
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
  })
  test('a share its quote does not state is dropped', () => {
    const w = goodWire()
    w.co_finance.min_share = 25
    expect(verify(w, docs).facts.co_finance).toBeNull()
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
  test('without a strong model a flag leaves the field unresolved and the programme unstamped', async () => {
    const r = await run(base, { read: fakeReader(pages), sources: [], cheap: fakeAsk([goodWire()]).ask, strong: null, jev: fakeJev([{ match: /^over0$/, p: 0.8 }]).ask })
    expect(r.outcomes.eligibility).toBe('unresolved')
    const { next } = apply(base, r, '2026-11-16', [])
    expect(next.requirements_checked).toBeUndefined()
    expect(next.eligibility).toBeUndefined()
    expect(next.documents).toHaveLength(2)
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
