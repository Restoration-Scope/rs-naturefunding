import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Programme, Source } from '../../src/data/schema'
import { programme as programmeSchema } from '../../src/data/schema'
import { deadlineInstant, deadlinePassed, parseZone } from './deadline'
import { classifyResponse, hashText, readPages, robotsAllows, type Fetched } from './fetch'
import { formatJson } from './json'
import { isDue, nextState, type SourceState } from './state'
import { applyTierA, classify, quotesAt } from './tier'
import { applyExtraction } from './tier-b'

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
    expect(applyTierA(fixture(), new Set(), new Date('2027-03-15T16:00:00.000Z')).closed).toEqual([])
    const { programme: p, closed } = applyTierA(fixture(), new Set(), new Date('2027-03-15T16:01:00Z'))
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
    const { programme: p, opened } = applyTierA(f, new Set(), new Date('2027-03-01T08:00:00Z'))
    expect(opened).toEqual(['round-2027'])
    expect(p.calls[0].status).toBe('open')
  })
  test('the result still passes the schema', () => {
    const { programme: p } = applyTierA(fixture(), new Set([URL_A, URL_B]), new Date('2028-01-01T00:00:00Z'))
    expect(programmeSchema.safeParse(p).success).toBe(true)
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
    const s = nextState({ ...prev, failures_in_row: 3 }, source, { ok: true, url: URL_A, status: 200, pdf: false, text: 'x', hash: 'sha256:bb' }, now)
    expect(s).toMatchObject({ failures_in_row: 0, last_error: null, last_hash: 'sha256:bb', last_change: '2026-11-01', last_ok: now.toISOString() })
  })
  test('403, 429 and challenge pages are blocked; 404 is an HTTP error; a normal page passes', () => {
    expect(classifyResponse(403, '')?.kind).toBe('blocked')
    expect(classifyResponse(429, '')?.kind).toBe('blocked')
    expect(classifyResponse(200, '<html><title>Just a moment...</title></html>')?.kind).toBe('blocked')
    expect(classifyResponse(404, '')?.kind).toBe('http')
    expect(classifyResponse(200, '<form>protected by reCAPTCHA</form>')).toBeNull()
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
    const { programme: p, changes, unconfirmed, schemaErrors } = applyExtraction(fixture(), source, {
      fields: { amount: { value: { currency: 'USD', max: 75000 }, quote: 'Up to USD 75,000 per project' } },
    }, page, now)
    expect(changes).toEqual([{ path: 'amount', kind: 'changed', old: { currency: 'USD', max: 50000 }, new: { currency: 'USD', max: 75000 }, quote: 'Up to USD 75,000 per project' }])
    expect(p.amount).toEqual({ currency: 'USD', max: 75000 })
    expect(p.evidence.amount).toEqual(ev(URL_A, 'Up to USD 75,000 per project', '2026-11-02'))
    expect(p.evidence.access?.checked_at).toBe('2026-11-02')
    expect(unconfirmed).toEqual([])
    expect(schemaErrors).toEqual([])
  })
  test('a fact whose quote is not on the page is rejected and the old one is listed as unconfirmed', () => {
    const { programme: p, changes, unconfirmed } = applyExtraction(fixture(), source, {
      fields: { amount: { value: { currency: 'USD', max: 90000 }, quote: 'Up to USD 90,000' } },
    }, page, now)
    expect(changes[0]).toMatchObject({ path: 'amount', kind: 'rejected', why: 'quote not on the page' })
    expect(p.amount).toEqual({ currency: 'USD', max: 50000 })
    expect(p.evidence.amount?.checked_at).toBe('2026-10-01')
    expect(unconfirmed).toEqual(['evidence.amount: "Up to USD 50,000"'])
  })
  test('facts from another page are left alone', () => {
    const { programme: p } = applyExtraction(fixture(), source, {
      fields: { geography: { value: { scope: 'regions', regions: ['africa'], label: 'Africa only' }, quote: 'Apply online' } },
    }, page, now)
    expect(p.geography).toEqual({ scope: 'global' })
    expect(p.evidence.geography?.checked_at).toBe('2026-10-01')
  })
})
