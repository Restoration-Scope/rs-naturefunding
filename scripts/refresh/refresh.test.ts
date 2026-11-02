import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Programme, Source } from '../../src/data/schema'
import { programme as programmeSchema } from '../../src/data/schema'
import { deadlineInstant, deadlinePassed, parseZone } from './deadline'
import { classifyResponse, hashText, readPages, robotsAllows, type Fetched } from './fetch'
import { formatJson } from './json'
import { answerText, llmFromEnv, provider } from './llm'
import { isDue, nextState, programmeChecks, type SourceState } from './state'
import { applyTierA, classify, quotesAt } from './tier'
import { applyExtraction, LIMITS, proposalKey, readReview } from './tier-b'

const URL_A = 'https://funder.example/call'
const URL_B = 'https://funder.example/eligibility'
const ev = (url: string, quote: string, checked_at = '2026-10-01') => ({ source_url: url, quote, checked_at, method: 'page' as const })

function fixture(): Programme {
  return {
    id: 'example-fund',
    name: 'Example Fund',
    funder: { name: 'Example Foundation', url: 'https://funder.example/' },
    administered_by: null,
    parent: null,
    url: URL_A,
    summary: 'Grants for community groups restoring mangroves along tropical coasts.',
    approaches: ['mangroves'],
    applicant_types: ['community_group'],
    geography: { scope: 'global' },
    access: 'direct',
    window: 'fixed',
    amount: { currency: 'USD', max: 50000 },
    co_finance_required: null,
    reporting: null,
    calls: [
      {
        id: 'round-2027',
        label: '2027 round',
        url: URL_A,
        status: 'open',
        opens: null,
        deadline: { date: '2027-03-15', time: '17:00', timezone: 'Europe/Madrid', text: '15 March 2027, 17:00 CET' },
        evidence: { status: ev(URL_A, 'Applications are open'), deadline: ev(URL_A, 'Deadline: 15 March 2027, 17:00 CET') },
      },
    ],
    evidence: {
      applicant_types: ev(URL_B, 'Community groups may apply'),
      geography: ev(URL_B, 'Open to applicants worldwide'),
      access: ev(URL_A, 'Apply online'),
      window: ev(URL_A, 'Applications are open'),
      amount: ev(URL_A, 'Up to USD 50,000'),
    },
    checked_at: '2026-10-01',
  }
}

describe('normalise and hash', () => {
  test('typography and spacing do not change the hash', () => {
    expect(hashText('Deadline – 15 March   2027 “today”')).toBe(hashText('Deadline - 15 March 2027 "today"'))
  })
  test('a changed word changes the hash', () => {
    expect(hashText('Deadline: 15 March 2027')).not.toBe(hashText('Deadline: 16 March 2027'))
  })
  test('hash is prefixed and hex', () => {
    expect(hashText('x')).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('Tier A/B classification', () => {
  const quotes = quotesAt([fixture()], URL_A)
  const text = 'Apply online. Applications are open. Up to USD 50,000 per project. Deadline: 15 March 2027, 17:00 CET.'
  const hash = hashText(text)

  test('only quotes citing the page are checked', () => {
    expect(quotes.map((q) => q.path).sort()).toEqual(
      ['calls[round-2027].evidence.deadline', 'calls[round-2027].evidence.status', 'evidence.access', 'evidence.amount', 'evidence.window'].sort(),
    )
  })
  test('unchanged page with every quote → A', () => {
    expect(classify({ hash, text }, hash, quotes)).toEqual({ tier: 'A', baseline: false })
  })
  test('first read with every quote → A, baseline', () => {
    expect(classify({ hash, text }, null, quotes)).toEqual({ tier: 'A', baseline: true })
  })
  test('quotes match across typography and case', () => {
    const fancy = text.replace('Deadline: 15 March 2027, 17:00 CET', 'DEADLINE: 15 March 2027, 17:00 CET')
    expect(classify({ hash: hashText(fancy), text: fancy }, null, quotes).tier).toBe('A')
  })
  test('changed page → B even when quotes remain', () => {
    const t = `${text} New: a second round opens in May.`
    const result = classify({ hash: hashText(t), text: t }, hash, quotes)
    expect(result).toEqual({ tier: 'B', reasons: ['page text changed since the last accepted read'] })
  })
  test('a gone quote → B, naming it', () => {
    const t = text.replace('Up to USD 50,000', 'Up to USD 75,000')
    const result = classify({ hash: hashText(t), text: t }, null, quotes)
    expect(result.tier).toBe('B')
    if (result.tier === 'B') expect(result.reasons).toEqual(['quote gone (example-fund evidence.amount): "Up to USD 50,000"'])
  })
  test('a blank or too-short quote never counts as present', () => {
    const blank = [{ programme_id: 'example-fund', path: 'evidence.amount', quote: '   ' }, { programme_id: 'example-fund', path: 'evidence.window', quote: 'Apply' }]
    expect(classify({ hash, text }, hash, blank).tier).toBe('B')
  })
  test('a redirect to another site → B even with the page unchanged; same site with or without www stays A', () => {
    const page = { hash, text, url: URL_A }
    expect(classify({ ...page, finalUrl: 'https://parked-domains.example/landing' }, hash, quotes))
      .toEqual({ tier: 'B', reasons: ['redirected to another site: https://parked-domains.example/landing'] })
    const sameSite = new URL(URL_A)
    sameSite.hostname = `www.${sameSite.hostname}`
    sameSite.pathname += '/'
    expect(classify({ ...page, finalUrl: sameSite.href }, hash, quotes).tier).toBe('A')
  })
})

describe('deadline boundary', () => {
  const d = (date: string, extra: { time?: string; timezone?: string } = {}) => ({ date, text: 'as written', ...extra })

  test('no timezone: open until the end of the day UTC', () => {
    expect(deadlinePassed(d('2027-03-15'), new Date('2027-03-15T23:59:59.999Z'))).toBe(false)
    expect(deadlinePassed(d('2027-03-15'), new Date('2027-03-16T00:00:00.000Z'))).toBe(true)
  })
  test('no timezone: a stated time alone does not close it early', () => {
    expect(deadlinePassed(d('2027-03-15', { time: '12:00' }), new Date('2027-03-15T18:00:00Z'))).toBe(false)
  })
  test('IANA zone with time, winter (CET = UTC+1)', () => {
    expect(deadlineInstant(d('2027-03-15', { time: '17:00', timezone: 'Europe/Madrid' })).toISOString()).toBe('2027-03-15T16:00:00.000Z')
  })
  test('IANA zone with time, summer (CEST = UTC+2)', () => {
    expect(deadlineInstant(d('2027-07-15', { time: '17:00', timezone: 'Europe/Madrid' })).toISOString()).toBe('2027-07-15T15:00:00.000Z')
  })
  test('zone without time: end of that local day (New York on daylight time from 14 March)', () => {
    expect(deadlineInstant(d('2027-03-15', { timezone: 'America/New_York' })).toISOString()).toBe('2027-03-16T03:59:59.999Z')
  })
  test('abbreviation and offset forms', () => {
    expect(deadlineInstant(d('2027-03-15', { time: '23:59', timezone: 'EAT' })).toISOString()).toBe('2027-03-15T20:59:00.000Z')
    expect(deadlineInstant(d('2027-03-15', { time: '12:00', timezone: 'GMT-5' })).toISOString()).toBe('2027-03-15T17:00:00.000Z')
    expect(deadlineInstant(d('2027-03-15', { time: '12:00', timezone: 'UTC+05:30' })).toISOString()).toBe('2027-03-15T06:30:00.000Z')
  })
  test('unreadable timezone: latest place on Earth (UTC-12)', () => {
    expect(parseZone('Nairobi time')).toBeNull()
    expect(deadlineInstant(d('2027-03-15', { time: '10:00', timezone: 'Nairobi time' })).toISOString()).toBe('2027-03-16T11:59:59.999Z')
  })
})

describe('Tier A apply', () => {
  const now = new Date('2027-03-15T15:59:00Z')

  test('bumps only facts from pages read today, programme date follows the oldest', () => {
    const { programme: p, changed, closed } = applyTierA(fixture(), new Set([URL_A]), now)
    expect(changed).toBe(true)
    expect(closed).toEqual([])
    expect(p.evidence.amount?.checked_at).toBe('2027-03-15')
    expect(p.evidence.geography?.checked_at).toBe('2026-10-01')
    expect(p.checked_at).toBe('2026-10-01')
  })
  test('every page read → programme dated today', () => {
    const { programme: p } = applyTierA(fixture(), new Set([URL_A, URL_B]), now)
    expect(p.checked_at).toBe('2027-03-15')
  })
  test('closes one minute after 17:00 Madrid, not before', () => {
    expect(applyTierA(fixture(), new Set([URL_A]), new Date('2027-03-15T16:00:00.000Z')).closed).toEqual([])
    const { programme: p, closed } = applyTierA(fixture(), new Set([URL_A]), new Date('2027-03-15T16:01:00Z'))
    expect(closed).toEqual(['round-2027'])
    expect(p.calls[0].status).toBe('closed')
    expect(p.calls[0].evidence.status.quote).toBe('Deadline: 15 March 2027, 17:00 CET')
    expect(p.calls).toHaveLength(1)
  })
  test('a closed call never gets a next round', () => {
    const { programme: p } = applyTierA(fixture(), new Set([URL_A, URL_B]), new Date('2028-01-01T00:00:00Z'))
    expect(p.calls.map((c) => [c.id, c.status])).toEqual([['round-2027', 'closed']])
  })
  test('upcoming call opens on its stated opening date', () => {
    const f = fixture()
    f.calls[0] = { ...f.calls[0], status: 'upcoming', opens: '2027-03-01', evidence: { ...f.calls[0].evidence, opens: ev(URL_A, 'Opens 1 March 2027') } }
    const { programme: p, opened } = applyTierA(f, new Set([URL_A]), new Date('2027-03-01T08:00:00Z'))
    expect(opened).toEqual(['round-2027'])
    expect(p.calls[0].status).toBe('open')
    expect(applyTierA(f, new Set(), new Date('2027-03-01T08:00:00Z')).opened).toEqual([])
  })
  test('a call past its stated deadline closes even when its pages failed or changed today', () => {
    const after = new Date('2027-03-16T00:00:00Z')
    for (const ok of [new Set<string>(), new Set([URL_B])]) {
      const { programme: p, closed } = applyTierA(fixture(), ok, after)
      expect(closed).toEqual(['round-2027'])
      expect(p.calls[0].status).toBe('closed')
      expect(p.calls[0].evidence.status).toEqual(fixture().calls[0].evidence.deadline!)
      expect(programmeSchema.safeParse(p).success).toBe(true)
    }
  })
  test('an upcoming call never opens once its deadline has passed, and opens only on a page read OK today', () => {
    const f = fixture()
    f.calls[0] = { ...f.calls[0], status: 'upcoming', opens: '2027-03-01', evidence: { ...f.calls[0].evidence, opens: ev(URL_A, 'Opens 1 March 2027') } }
    const late = applyTierA(f, new Set([URL_A, URL_B]), new Date('2027-03-15T16:01:00Z'))
    expect([late.opened, late.closed]).toEqual([[], ['round-2027']])
    // The status page read OK but the opens page didn't: no opening, and no claim it was still upcoming today.
    f.calls[0].evidence.opens = ev(URL_B, 'Opens 1 March 2027')
    const unread = applyTierA(f, new Set([URL_A]), new Date('2027-03-02T08:00:00Z'))
    expect(unread.opened).toEqual([])
    expect(unread.programme.calls[0].evidence.status.checked_at).toBe('2026-10-01')
    expect(programmeSchema.safeParse(unread.programme).success).toBe(true)
  })
  test('the result still passes the schema', () => {
    const { programme: p } = applyTierA(fixture(), new Set([URL_A, URL_B]), new Date('2028-01-01T00:00:00Z'))
    expect(programmeSchema.safeParse(p).success).toBe(true)
  })
  test('refresh and schema share one cutoff: open on the deadline day before the hour passes the schema, closed after it too', () => {
    const before = applyTierA(fixture(), new Set([URL_A, URL_B]), new Date('2027-03-15T15:59:00Z')).programme
    expect(before.calls[0]).toMatchObject({ status: 'open', evidence: { status: { checked_at: '2027-03-15' } } })
    expect(programmeSchema.safeParse(before).success).toBe(true)
    const after = applyTierA(fixture(), new Set([URL_A, URL_B]), new Date('2027-03-15T16:01:00Z')).programme
    expect(after.calls[0].status).toBe('closed')
    expect(programmeSchema.safeParse(after).success).toBe(true)
  })
  test('nothing read and nothing due → unchanged', () => {
    expect(applyTierA(fixture(), new Set(), new Date('2026-11-01T00:00:00Z')).changed).toBe(false)
  })
})

describe('blocked fetch', () => {
  const source: Source = { id: 'example-call', programme_id: 'example-fund', url: URL_A, selector: null, hint: null, cycle: 'daily' }
  const prev: SourceState = {
    source_id: 'example-call', url: URL_A, last_attempt: '2026-10-31T05:00:00.000Z', last_ok: '2026-10-31T05:00:00.000Z',
    last_change: null, last_hash: 'sha256:aa', last_error: null, failures_in_row: 2,
  }
  const blocked: Fetched = { ok: false, url: URL_A, kind: 'blocked', message: 'HTTP 403' }
  const now = new Date('2026-11-01T05:00:00Z')

  test('records the error, keeps last_ok, counts failures in a row', () => {
    const s = nextState(prev, source, blocked, now)
    expect(s.last_ok).toBe(prev.last_ok)
    expect(s.last_hash).toBe('sha256:aa')
    expect(s.failures_in_row).toBe(3)
    expect(s.last_error).toEqual({ at: '2026-11-01T05:00:00.000Z', kind: 'blocked', message: 'HTTP 403' })
  })
  test('keeps checked_at: a blocked page is not in the read set', () => {
    const { programme: p } = applyTierA(fixture(), new Set([URL_B]), now)
    expect(p.evidence.amount?.checked_at).toBe('2026-10-01')
    expect(p.calls[0].evidence.status.checked_at).toBe('2026-10-01')
  })
  test('a good read resets the count and dates the change', () => {
    const s = nextState({ ...prev, failures_in_row: 3 }, source, { ok: true, url: URL_A, finalUrl: URL_A, status: 200, pdf: false, text: 'x', hash: 'sha256:bb' }, now)
    expect(s).toMatchObject({ failures_in_row: 0, last_error: null, last_hash: 'sha256:bb', last_change: '2026-11-01', last_ok: now.toISOString() })
  })
  test('403, 429 and challenge pages are blocked; 404 is an HTTP error; a normal page passes', () => {
    expect(classifyResponse(403, '')?.kind).toBe('blocked')
    expect(classifyResponse(429, '')?.kind).toBe('blocked')
    expect(classifyResponse(200, '<html><title>Just a moment...</title></html>')?.kind).toBe('blocked')
    expect(classifyResponse(404, '')?.kind).toBe('http')
    expect(classifyResponse(200, '<html><body>Request unsuccessful. Incapsula incident ID: 123</body></html>')?.kind).toBe('blocked')
    expect(classifyResponse(200, '<form>protected by reCAPTCHA</form>')).toBeNull()
  })
  test('a programme whose page failed its latest read is marked not re-checked, with the worst reason', () => {
    const other: Source = { ...source, id: 'example-eligibility', url: URL_B }
    const failed = nextState(prev, source, blocked, now)
    const robots = { ...nextState(null, other, { ok: false, url: URL_B, kind: 'robots', message: 'disallowed' }, now) }
    const p = fixture()
    expect(programmeChecks([p], [source, other], { [source.id]: failed, [other.id]: robots })[p.id]).toEqual({
      last_read: p.checked_at, rechecked: false, reason: 'robots', failing_sources: ['example-call', 'example-eligibility'],
    })
    const ok = nextState(failed, source, { ok: true, url: URL_A, finalUrl: URL_A, status: 200, pdf: false, text: 'x', hash: 'sha256:aa' }, now)
    expect(programmeChecks([p], [source], { [source.id]: ok })[p.id]).toEqual({ last_read: p.checked_at, rechecked: true, reason: null, failing_sources: [] })
  })
  test('weekly sources wait a week after a good read, but a failed one retries', () => {
    const weekly = { ...source, cycle: 'weekly' as const }
    expect(isDue(weekly, prev, now)).toBe(false)
    expect(isDue(weekly, { ...prev, last_ok: '2026-10-20T05:00:00.000Z' }, now)).toBe(true)
    expect(isDue(weekly, { ...prev, last_ok: null }, now)).toBe(true)
  })
})

describe('polite fetching', () => {
  test('robots.txt: our group wins over *, longest rule wins', () => {
    const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: naturefunding-refresh\nDisallow: /private\nAllow: /private/calls'
    expect(robotsAllows(robots, '/calls')).toBe(true)
    expect(robotsAllows(robots, '/private/x')).toBe(false)
    expect(robotsAllows(robots, '/private/calls/2027')).toBe(true)
    expect(robotsAllows('User-agent: *\nDisallow: /admin', '/grants')).toBe(true)
    expect(robotsAllows('User-agent: *\nDisallow: /', '/grants')).toBe(false)
  })
  test('one request at a time per host, with a gap', async () => {
    const log: { host: string; at: number }[] = []
    const read = async (url: string): Promise<Fetched> => {
      log.push({ host: new URL(url).host, at: performance.now() })
      return { ok: false, url, kind: 'network', message: 'test' }
    }
    const items = ['https://a.example/1', 'https://a.example/2', 'https://b.example/1'].map((url) => ({ url, selector: null }))
    const results = await readPages(items, read, 50)
    expect(results.size).toBe(3)
    const a = log.filter((l) => l.host === 'a.example')
    expect(a[1].at - a[0].at).toBeGreaterThanOrEqual(45)
  })
})

describe('json format', () => {
  test('rewrites the hand-written data files byte for byte', () => {
    const file = readFileSync('data/sources.json', 'utf8')
    expect(formatJson(JSON.parse(file))).toBe(file)
  })
})

describe('Tier B apply', () => {
  const source: Source = { id: 'example-call', programme_id: 'example-fund', url: URL_A, selector: null, hint: null, cycle: 'daily' }
  const now = new Date('2026-11-02T06:00:00Z')
  const page = 'Apply online. Applications are open. Up to USD 75,000 per project. Deadline: 15 March 2027, 17:00 CET.'

  test('a changed fact with its quote on the page moves, dated today', () => {
    const { programme, changes, unconfirmed, schemaErrors } = applyExtraction(fixture(), source, {
      fields: { amount: { value: { currency: 'USD', max: 75000 }, quote: 'Up to USD 75,000 per project' } },
    }, page, now)
    const p = programme!
    expect(changes).toEqual([{ path: 'amount', kind: 'changed', old: { currency: 'USD', max: 50000 }, new: { currency: 'USD', max: 75000 }, quote: 'Up to USD 75,000 per project' }])
    expect(p.amount).toEqual({ currency: 'USD', max: 75000 })
    expect(p.evidence.amount).toEqual(ev(URL_A, 'Up to USD 75,000 per project', '2026-11-02'))
    expect(p.evidence.access?.checked_at).toBe('2026-11-02')
    expect(unconfirmed).toEqual([])
    expect(schemaErrors).toEqual([])
  })
  test('a fact whose quote is not on the page is rejected and the old one is listed as unconfirmed', () => {
    const { programme, changes, unconfirmed } = applyExtraction(fixture(), source, {
      fields: { amount: { value: { currency: 'USD', max: 90000 }, quote: 'Up to USD 90,000' } },
    }, page, now)
    const p = programme!
    expect(changes[0]).toMatchObject({ path: 'amount', kind: 'rejected', why: 'quote not on the page' })
    expect(p.amount).toEqual({ currency: 'USD', max: 50000 })
    expect(p.evidence.amount?.checked_at).toBe('2026-10-01')
    expect(unconfirmed).toEqual(['evidence.amount: "Up to USD 50,000"'])
  })
  test('facts from another page are left alone', () => {
    const { programme } = applyExtraction(fixture(), source, {
      fields: { geography: { value: { scope: 'regions', regions: ['africa'], label: 'Africa only' }, quote: 'Apply online' } },
    }, page, now)
    const p = programme!
    expect(p.geography).toEqual({ scope: 'global' })
    expect(p.evidence.geography?.checked_at).toBe('2026-10-01')
  })
  test('a value with keys the schema does not know is refused, not stripped and written', () => {
    const { programme, changes } = applyExtraction(fixture(), source, {
      fields: { amount: { value: { currency: 'USD', max: 75000, injected: '<script>' }, quote: 'Up to USD 75,000 per project' } },
    }, page, now)
    expect(changes[0]).toMatchObject({ path: 'amount', kind: 'rejected', new: '(not shown)', why: 'value has keys the schema does not know' })
    expect(programme!.amount).toEqual({ currency: 'USD', max: 50000 })
    expect(JSON.stringify(programme)).not.toContain('injected')
  })
  test('a value of the wrong shape, an over-long quote and junk in place of calls are refused', () => {
    const long = `${page} ${'x'.repeat(LIMITS.quote)}`
    const { programme, changes } = applyExtraction(fixture(), source, {
      fields: { co_finance_required: { value: 'maybe', quote: 'Apply online' }, amount: { value: { currency: 'USD', max: 75000 }, quote: long } },
      calls: 'not a list',
    }, long, now)
    expect(changes.map((c) => [c.path, c.kind, c.why?.split(' (')[0]])).toEqual([
      ['amount', 'rejected', `quote longer than ${LIMITS.quote} characters`],
      ['co_finance_required', 'rejected', 'value does not fit the schema'],
    ])
    expect(changes.every((c) => c.quote.length <= LIMITS.quote)).toBe(true)
    expect(programme!.amount).toEqual({ currency: 'USD', max: 50000 })
  })
  test('over-long text, unknown call keys and too many calls are refused', () => {
    const call = (id: string, extra = {}) => ({ id, label: 'Round', url: URL_A, status: 'open', ...extra, quotes: { status: 'Applications are open' } })
    const { programme, changes } = applyExtraction(fixture(), source, {
      fields: { reporting: { value: 'r'.repeat(LIMITS.text + 1), quote: 'Apply online. Applications are open.' } },
      calls: [call('extra-key', { script: 'x' }), ...Array.from({ length: LIMITS.calls + 4 }, (_, i) => call(`round-${i + 1}`))],
    }, page, now)
    const rejected = changes.filter((c) => c.kind === 'rejected').map((c) => [c.path, c.why])
    expect(rejected).toEqual([
      ['reporting', `value longer than ${LIMITS.text} characters`],
      ['calls', `${LIMITS.calls + 5} calls; only the first ${LIMITS.calls} were read`],
      ['calls[extra-key]', 'call has keys the schema does not know (script)'],
    ])
    expect(programme!.reporting).toBe(fixture().reporting)
    expect(programme!.calls.length).toBe(fixture().calls.length + LIMITS.calls - 1)
    expect(JSON.stringify(programme)).not.toContain('script')
  })
  test('a call with an extra key is refused; the reviewer answer is cut to shape', () => {
    const { programme, changes } = applyExtraction(fixture(), source, {
      calls: [{ id: 'round-2', label: 'Round 2', url: URL_A, status: 'open', deadline: { date: '2027-03-15', text: '15 March 2027', extra: 1 }, quotes: { status: 'Applications are open', deadline: 'Deadline: 15 March 2027' } }],
    }, page, now)
    expect(changes[0]).toMatchObject({ path: 'calls[round-2]', kind: 'rejected' })
    expect(programme!.calls.map((c) => c.id)).not.toContain('round-2')
    expect(readReview({ overall: 'yes', verdicts: [{ path: 'amount', verdict: 'supported', reason: 'r'.repeat(500), x: 1 }, 'junk'], missed: 5 }))
      .toEqual({ overall: 'unclear', verdicts: [{ path: 'amount', verdict: 'supported', reason: 'r'.repeat(300) }], missed: '' })
  })
  test('amount qualifiers the draft leaves out are kept; null removes one; "less than" goes with the max', () => {
    const base = fixture()
    base.amount = { currency: 'USD', max: 50000, max_exclusive: true, per: 'year', note: 'Up to USD 150,000 in total' }
    const run = (value: object) => applyExtraction(base, source, { fields: { amount: { value, quote: 'Up to USD 75,000 per project' } } }, page, now)
    expect(run({ currency: 'USD', max: 75000 }).programme!.amount).toEqual({ currency: 'USD', max: 75000, max_exclusive: true, per: 'year', note: 'Up to USD 150,000 in total' })
    expect(run({ currency: 'USD', max: 75000, per: null, note: null }).programme!.amount).toEqual({ currency: 'USD', max: 75000, max_exclusive: true })
    expect(run({ currency: 'USD', min: 5000 }).programme!.amount).toEqual({ currency: 'USD', min: 5000, per: 'year', note: 'Up to USD 150,000 in total' })
  })
  describe('call qualifiers', () => {
    const quiet = 'The next round is expected in June 2027, subject to funding approval. Deadlines are 1 March each year. Opens 1 June 2027.'
    const upcoming = () => {
      const p = fixture()
      p.calls[0] = {
        id: 'round-2027', label: '2027 round', url: URL_A, status: 'upcoming', opens: null, deadline: null,
        expected: 'June 2027', recurring: '1 March each year', note: 'Subject to funding approval',
        evidence: { status: ev(URL_A, 'The next round is expected in June 2027'), recurring: ev(URL_A, 'Deadlines are 1 March each year') },
      }
      return p
    }
    const draft = (extra: object = {}, quotes: object = {}) => ({
      calls: [{ id: 'round-2027', label: '2027 round', url: URL_A, status: 'upcoming', ...extra, quotes: { status: 'The next round is expected in June 2027', ...quotes } }],
    })

    test('a draft that leaves them out keeps them, with their evidence, and changes nothing', () => {
      const { programme, changes, schemaErrors } = applyExtraction(upcoming(), source, draft(), quiet, now)
      const c = programme!.calls[0]
      expect(schemaErrors).toEqual([])
      expect(changes).toEqual([])
      expect([c.expected, c.recurring, c.note]).toEqual(['June 2027', '1 March each year', 'Subject to funding approval'])
      expect(c.evidence.recurring).toEqual(ev(URL_A, 'Deadlines are 1 March each year', '2026-11-02'))
    })
    test('a firm opening date drops the kept expected one; null removes a qualifier', () => {
      const { programme, changes } = applyExtraction(upcoming(), source, draft({ opens: '2027-06-01', note: null }, { opens: 'Opens 1 June 2027' }), quiet, now)
      const c = programme!.calls[0]
      expect(changes[0]).toMatchObject({ path: 'calls[round-2027]', kind: 'changed' })
      expect([c.opens, c.expected, c.note, c.recurring]).toEqual(['2027-06-01', undefined, undefined, '1 March each year'])
    })
    test('a new expected opening needs its year in the status quote; new recurring dates need their quote on the page', () => {
      const p = fixture()
      const add = (extra: object, quotes: object = {}) => applyExtraction(p, source, {
        calls: [{ id: 'next', label: 'Next round', url: URL_A, status: 'upcoming', ...extra, quotes: { status: 'subject to funding approval', ...quotes } }],
      }, quiet, now).changes[0]
      expect(add({ expected: 'June 2027' })).toMatchObject({ kind: 'rejected', why: 'an expected opening names a year that its status quote states' })
      expect(add({ recurring: '1 March each year' }, { recurring: 'Deadlines are 1 April' })).toMatchObject({ kind: 'rejected', why: 'quote not on the page' })
      expect(add({ recurring: '1 March each year', note: 'Subject to funding approval' }, { recurring: 'Deadlines are 1 March each year' })).toMatchObject({ kind: 'added' })
    })
  })
})

describe('Tier B proposal key', () => {
  const source: Source = { id: 'example-call', programme_id: 'example-fund', url: URL_A, selector: null, hint: null, cycle: 'daily' }
  test('check dates and facts from other pages do not make a new proposal; a fact from this page or a new page version does', () => {
    const a = fixture()
    const key = proposalKey(source, 'sha256:1', a)
    const later = structuredClone(a)
    later.checked_at = '2026-11-09'
    later.evidence.amount!.checked_at = '2026-11-09'
    later.calls[0].evidence.status.checked_at = '2026-11-09'
    expect(proposalKey(source, 'sha256:1', later)).toBe(key)
    const elsewhere = structuredClone(a)
    elsewhere.geography = { scope: 'regions', regions: ['africa'], label: 'Africa only' }
    expect(a.evidence.geography?.source_url).toBe(URL_B)
    expect(proposalKey(source, 'sha256:1', elsewhere)).toBe(key)
    const changed = structuredClone(a)
    changed.amount = { currency: 'USD', max: 60000 }
    expect(proposalKey(source, 'sha256:1', changed)).not.toBe(key)
    expect(proposalKey(source, 'sha256:2', a)).not.toBe(key)
  })
})

describe('LLM provider from the environment', () => {
  const account = { CLOUDFLARE_ACCOUNT_ID: 'acct' }
  test('blank repo variables fall back to defaults instead of disabling the models', () => {
    const llm = llmFromEnv({ ...account, CLOUDFLARE_API_TOKEN: 't', LLM_PROVIDER: '', LLM_EXTRACTOR: ' ', LLM_REVIEWER: '' })
    expect(llm).toMatchObject({ provider: 'cloudflare', extractor: '@cf/openai/gpt-oss-120b', reviewer: '@cf/meta/llama-4-scout-17b-16e-instruct' })
  })
  test('a dedicated AI token wins over the deploy token; overrides are used when set', () => {
    expect(provider({ ...account, CLOUDFLARE_AI_TOKEN: 'ai', CLOUDFLARE_API_TOKEN: 'deploy' })?.[1].key).toBe('ai')
    expect(llmFromEnv({ ...account, CLOUDFLARE_API_TOKEN: 't', LLM_REVIEWER: '@cf/other/model' })?.reviewer).toBe('@cf/other/model')
  })
  test('no token, a blank token or an unknown provider → no models, so changed pages become issues', () => {
    expect(llmFromEnv({ ...account })).toBeNull()
    expect(llmFromEnv({ ...account, CLOUDFLARE_API_TOKEN: '' })).toBeNull()
    expect(llmFromEnv({ ...account, CLOUDFLARE_API_TOKEN: 't', LLM_PROVIDER: 'github' })).toBeNull()
  })
  test('an answer a reasoning model left empty says why instead of passing', () => {
    expect(answerText({ choices: [{ message: { content: '{"a":1}' } }] })).toBe('{"a":1}')
    expect(answerText({ result: { response: '{}' } })).toBe('{}')
    expect(() => answerText({ choices: [{ message: { content: null, reasoning_content: '…' }, finish_reason: 'length' }] })).toThrow('finish_reason length')
  })
})
