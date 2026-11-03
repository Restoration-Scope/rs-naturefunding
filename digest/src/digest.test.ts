import { describe, expect, test } from 'bun:test'
import { loadProgrammes } from '../../src/data/load'
import type { Programme } from '../../src/data/schema'
import { whereCodes as siteWhereCodes } from '../../src/lib/data'
import { buildDigest } from './digest'
import { digestEmail } from './email'
import { diffSnapshots, type Snapshot } from './events'
import { cleanPrefs, matches, whereCodes } from './match'
import { open, seal } from './token'

const programmes = loadProgrammes()
const byId = new Map(programmes.map((p) => [p.id, p]))
const snap = (o: Record<string, [string, string][]>): Snapshot =>
  new Map(Object.entries(o).map(([id, calls]) => [id, { calls: calls.map(([cid, status]) => ({ id: cid, status })) }]))

describe('events from two snapshots', () => {
  const at = '2026-11-08T00:00:00.000Z'
  test('a new programme, a call that opened, one announced, and a new open call', () => {
    const before = snap({ a: [['r1', 'closed']], b: [['r1', 'unknown']], c: [['r1', 'closed']] })
    const after = snap({ a: [['r1', 'open']], b: [['r1', 'upcoming']], c: [['r1', 'closed'], ['r2', 'open']], d: [['x', 'closed'], ['y', 'upcoming']] })
    expect(diffSnapshots(before, after, at)).toEqual([
      { at, kind: 'opened', programme: 'a', call: 'r1' },
      { at, kind: 'announced', programme: 'b', call: 'r1' },
      { at, kind: 'opened', programme: 'c', call: 'r2' },
      { at, kind: 'new_programme', programme: 'd', call: 'y' },
    ])
  })
  test('nothing for calls that close, go unclear or stay the same', () => {
    const before = snap({ a: [['r1', 'open']], b: [['r1', 'open']], c: [['r1', 'upcoming']] })
    const after = snap({ a: [['r1', 'closed']], b: [['r1', 'unknown']], c: [['r1', 'upcoming']] })
    expect(diffSnapshots(before, after, at)).toEqual([])
  })
  test('open back to upcoming is an announcement', () => {
    expect(diffSnapshots(snap({ a: [['r1', 'open']] }), snap({ a: [['r1', 'upcoming']] }), at)).toEqual([{ at, kind: 'announced', programme: 'a', call: 'r1' }])
  })
})

describe('filters match the finder', () => {
  test('where codes are the ones the finder rows carry', () => {
    for (const p of programmes) expect(whereCodes(p).join(' '), p.id).toBe(siteWhereCodes(p))
  })
  test('a country matches its own listings, its region-wide ones and worldwide ones', () => {
    const worldwide = programmes.find((p) => p.geography?.scope === 'global')!
    const kenya = programmes.find((p) => p.geography?.scope === 'countries' && p.geography.countries.includes('KE'))!
    const brazilOnly = programmes.find((p) => p.geography?.scope === 'countries' && p.geography.countries.join() === 'BR')
    const prefs = cleanPrefs('KE', [])
    expect(matches(worldwide, prefs)).toBe(true)
    expect(matches(kenya, prefs)).toBe(true)
    if (brazilOnly) expect(matches(brazilOnly, prefs)).toBe(false)
  })
  test('approaches need one in common; unknown values mean no filter', () => {
    const p = programmes.find((x) => x.approaches.includes('mangroves'))!
    expect(matches(p, cleanPrefs('', ['mangroves', 'peatlands']))).toBe(true)
    expect(cleanPrefs('Narnia', ['flying', 'mangroves'])).toEqual({ where: '', approaches: ['mangroves'] })
    expect(cleanPrefs('r:africa', 'wetlands')).toEqual({ where: 'r:africa', approaches: ['wetlands'] })
  })
})

describe('one subscriber’s digest', () => {
  const now = '2026-11-15T09:00:00.000Z'
  const today = now.slice(0, 10)
  const openCall = (p: Programme) => p.calls.find((c) => c.status === 'open' && !(c.deadline && c.deadline.date < today))
  const withOpen = programmes.find((p) => openCall(p))!
  const withClosedOnly = programmes.find((p) => p.calls.length > 0 && p.calls.every((c) => c.status === 'closed'))!

  test('only events after `since`, only calls still live, new programmes once', () => {
    const events = [
      { at: '2026-11-01T00:00:00.000Z', kind: 'opened' as const, programme: withOpen.id, call: openCall(withOpen)!.id },
      { at: '2026-11-10T00:00:00.000Z', kind: 'opened' as const, programme: withOpen.id, call: openCall(withOpen)!.id },
      { at: '2026-11-10T00:00:00.000Z', kind: 'opened' as const, programme: withClosedOnly.id, call: withClosedOnly.calls[0]!.id },
      { at: '2026-11-11T00:00:00.000Z', kind: 'new_programme' as const, programme: withClosedOnly.id, call: null },
      { at: '2026-11-11T00:00:00.000Z', kind: 'new_programme' as const, programme: 'removed-since', call: null },
    ]
    const d = buildDigest(events, byId, { where: '', approaches: [] }, '2026-11-08T00:00:00.000Z', now)
    expect(d.items.map((i) => [i.section, i.programme.id, i.call?.id ?? null])).toEqual([
      ['open', withOpen.id, openCall(withOpen)!.id],
      ['new', withClosedOnly.id, null],
    ])
  })

  test('a call that opened before the last email and opened again after it is news again', () => {
    const c = openCall(withOpen)!
    const events = [
      { at: '2026-11-02T00:00:00.000Z', kind: 'opened' as const, programme: withOpen.id, call: c.id },
      { at: '2026-11-09T00:00:00.000Z', kind: 'opened' as const, programme: withOpen.id, call: c.id },
    ]
    expect(buildDigest(events, byId, { where: '', approaches: [] }, '2026-11-03T08:00:00.000Z', now).items).toHaveLength(1)
  })

  test('a deadline counts in the funder\u2019s time zone', () => {
    const c = openCall(withOpen)!
    const withDeadline = (deadline: NonNullable<typeof c.deadline>) =>
      new Map([[withOpen.id, { ...withOpen, calls: [{ ...c, deadline }] }]])
    const ev = [{ at: '2026-11-01T00:00:00.000Z', kind: 'opened' as const, programme: withOpen.id, call: c.id }]
    const run = (deadline: NonNullable<typeof c.deadline>, at: string) =>
      buildDigest(ev, withDeadline(deadline), { where: '', approaches: [] }, '2026-10-31T00:00:00.000Z', at).items.length
    // 09:00 in Tokyo on 3 November is 00:00 UTC, so it has passed by the 08:00 UTC send.
    expect(run({ date: '2026-11-03', time: '09:00', timezone: 'Asia/Tokyo', text: '3 Nov 09:00 JST' }, '2026-11-03T08:00:00.000Z')).toBe(0)
    // 23:59 in Hawaii on 2 November is still ahead at 08:00 UTC on 3 November.
    expect(run({ date: '2026-11-02', time: '23:59', timezone: 'Pacific/Honolulu', text: '2 Nov 23:59 HST' }, '2026-11-03T08:00:00.000Z')).toBe(1)
  })

  test('nothing new means an empty digest', () => {
    expect(buildDigest([], byId, { where: '', approaches: [] }, '2026-11-08T00:00:00.000Z', now).items).toEqual([])
  })

  test('the email escapes text, links each listing and carries the unsubscribe link', () => {
    const d = buildDigest(
      [{ at: '2026-11-10T00:00:00.000Z', kind: 'opened', programme: withOpen.id, call: openCall(withOpen)!.id }],
      byId,
      { where: '', approaches: [] },
      '2026-11-08T00:00:00.000Z',
      now,
    )
    const e = digestEmail({ site: 'https://naturefunding.org', digest: d, prefs: { where: 'KE', approaches: [] }, since: '2026-11-08T00:00:00.000Z', unsubscribeUrl: 'https://email.naturefunding.org/unsubscribe?t=x', manageUrl: 'https://naturefunding.org/digest/' })
    expect(e.subject).toBe('1 call open · Kenya')
    expect(e.html).toContain(`https://naturefunding.org/p/${withOpen.id}/`)
    expect(e.html).toContain('https://email.naturefunding.org/unsubscribe?t=x')
    expect(e.text).toContain('New since November 8, 2026, for Kenya.')
  })
})

describe('link tokens', () => {
  test('round-trip, and refuse a changed token or another secret', async () => {
    const t = await seal({ k: 'unsubscribe', id: 'abc' }, 's1')
    expect(await open(t, 's1')).toEqual({ k: 'unsubscribe', id: 'abc' })
    expect(await open(t, 's2')).toBeNull()
    expect(await open(t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA'), 's1')).toBeNull()
    expect(await open('nonsense', 's1')).toBeNull()
  })
})
