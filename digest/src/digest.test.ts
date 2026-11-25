import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadProgrammes } from '../../src/data/load'
import type { Programme } from '../../src/data/schema'
import { marks } from '../../src/lib/marks'
import { buildDigest, type DigestItem } from './digest'
import { digestEmail, finderUrl, itemParts, POSTAL_ADDRESS } from './email'
import { pagePaths } from '../../src/lib/finder-pages'
import { pageKey } from '../../src/lib/page-paths'
import { diffSnapshots, type Snapshot } from './events'
import { cleanPrefs, matches } from './match'
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
  test('a group with no country list is in the email only as a place to check', () => {
    const i = { section: 'new', programme: byId.get('neaq-mcaf')!, call: null } as unknown as DigestItem
    expect(matches(byId.get('dimfe-call-for-projects')!, cleanPrefs('KE', []))).toBe(false)
    expect(matches(i.programme, cleanPrefs('KE', []))).toBe(true)
    expect(itemParts(i, 'https://x', cleanPrefs('KE', [])).place).toBe('Check the place: low- and middle-income countries around the globe')
  })
  test('the subject never counts a programme that may not take the country', () => {
    const prefs = cleanPrefs('KE', [])
    const d = buildDigest([{ at: '2026-11-10T00:00:00.000Z', kind: 'new_programme', programme: 'neaq-mcaf', call: null } as never], byId, prefs, '2026-11-08T00:00:00.000Z', '2026-11-15T09:00:00.000Z')
    expect([d.counts.new, d.check]).toEqual([0, 1])
    expect(digestEmail({ site: 'https://x', digest: d, prefs, since: '2026-11-08T00:00:00.000Z', unsubscribeUrl: 'u', manageUrl: 'm' }).subject).toBe('1 to check · Kenya')
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

  test('one line per programme: several open rounds show the one that closes first', () => {
    const p = programmes.find((x) => x.calls.filter((c) => c.status === 'open' && c.deadline && c.deadline.date >= today).length >= 2)!
    expect(p).toBeDefined()
    const rounds = p.calls.filter((c) => c.status === 'open' && c.deadline && c.deadline.date >= today)
    const events = rounds.map((c) => ({ at: '2026-11-10T00:00:00.000Z', kind: 'opened' as const, programme: p.id, call: c.id }))
    const d = buildDigest(events, byId, { where: '', approaches: [] }, '2026-11-08T00:00:00.000Z', now)
    const first = [...rounds].sort((a, b) => a.deadline!.date.localeCompare(b.deadline!.date))[0]!
    expect(d.items.map((i) => i.call?.id)).toEqual([first.id])
    expect(d.total).toBe(1)
  })

  test('new programmes with an open call come before those with none, whatever their names', () => {
    const closed = programmes.filter((p) => p.calls.every((c) => c.status === 'closed')).sort((a, b) => a.name.localeCompare(b.name))[0]!
    const live = programmes.filter((p) => openCall(p)).sort((a, b) => b.name.localeCompare(a.name))[0]!
    const events = [closed, live].map((p) => ({ at: '2026-11-10T00:00:00.000Z', kind: 'new_programme' as const, programme: p.id, call: null }))
    const d = buildDigest(events, byId, { where: '', approaches: [] }, '2026-11-08T00:00:00.000Z', now)
    expect(d.items.map((i) => i.programme.id)).toEqual([live.id, closed.id])
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
    expect(e.text).toContain('New for Kenya since November 8, 2026.')
    // The sender's postal address in both versions (CAN-SPAM).
    expect(e.html).toContain('411 Walnut Street #24052')
    expect(e.text).toContain(POSTAL_ADDRESS)
  })
  test('the digest links the country page from the intro and at the end', () => {
    const d = buildDigest([{ at: '2026-11-10T00:00:00.000Z', kind: 'opened', programme: withOpen.id, call: openCall(withOpen)!.id }], byId, { where: '', approaches: [] }, '2026-11-08T00:00:00.000Z', now)
    const e = digestEmail({ site: 'https://naturefunding.org', pages: pagePaths, digest: d, prefs: { where: 'CR', approaches: [] }, since: '2026-11-08T00:00:00.000Z', unsubscribeUrl: 'u', manageUrl: 'm' })
    expect(e.html.split('href="https://naturefunding.org/countries/costa-rica/"').length - 1).toBe(2)
    expect(e.text).toContain('See all grants for Costa Rica on naturefunding.org: https://naturefunding.org/countries/costa-rica/')
  })
})

describe('a call for some of the programme’s countries', () => {
  const now = '2026-11-15T09:00:00.000Z'
  const faf = byId.get('forest-action-facility')!
  const c = (id: string, status: 'open' | 'upcoming' | 'closed', countries: string[]) => ({ ...faf.calls[0]!, id, status, label: id, opens: null, deadline: null, expected: undefined, countries })
  const p: Programme = { ...faf, calls: [c('ecuador', 'closed', ['EC']), c('central-america', 'upcoming', ['CR', 'PA'])] }
  const announced = { at: '2026-11-10T00:00:00.000Z', kind: 'announced' as const, programme: p.id, call: 'central-america' }
  const isNew = { at: '2026-11-10T00:00:00.000Z', kind: 'new_programme' as const, programme: p.id, call: 'central-america' }
  const run = (event: typeof announced | typeof isNew, where: string, programme = p) => {
    const prefs = cleanPrefs(where, [])
    const d = buildDigest([event], new Map([[p.id, programme]]), prefs, '2026-11-08T00:00:00.000Z', now)
    const { subject } = digestEmail({ site: 'https://x', digest: d, prefs, since: '2026-11-08T00:00:00.000Z', unsubscribeUrl: 'u', manageUrl: 'm' })
    return { items: d.items.map((i) => [i.section, i.call?.id ?? null]), total: d.total, subject }
  }

  test('Ecuador gets no email about the Central America call', () => {
    expect(run(announced, 'EC')).toMatchObject({ items: [], total: 0 })
  })
  test('the call’s own countries, their region and anywhere do', () => {
    expect(run(announced, 'CR')).toEqual({ items: [['upcoming', 'central-america']], total: 1, subject: '1 call opening soon · Costa Rica' })
    expect(run(announced, 'r:latin_america_caribbean').total).toBe(1)
    expect(run(announced, '').total).toBe(1)
  })
  test('a region with none of the call’s countries gets no email about it', () => {
    const wide: Programme = { ...p, geography: { scope: 'regions', regions: ['africa', 'latin_america_caribbean'], label: 'Africa and Latin America', whole: true } }
    expect(run(announced, 'r:africa', wide).total).toBe(0)
    expect(run(announced, 'r:latin_america_caribbean', wide).total).toBe(1)
  })
  test('a new programme is new for each of its countries, with a call only where one is live', () => {
    expect(run(isNew, 'EC')).toEqual({ items: [['new', null]], total: 1, subject: '1 new programme · Ecuador' })
    expect(run(isNew, 'CR').items).toEqual([['new', 'central-america']])
    const both = { ...p, calls: [c('ecuador', 'open', ['EC']), c('central-america', 'upcoming', ['CR'])] }
    expect(run(isNew, 'CR', both).items).toEqual([['new', 'central-america']])
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

describe('finderUrl', () => {
  test('without the page map, opens the finder with the same choices', () => {
    expect(finderUrl('https://x.org', { where: '', approaches: [] })).toBe('https://x.org/')
    expect(finderUrl('https://x.org', { where: 'KE', approaches: [] })).toBe('https://x.org/?where=KE')
    expect(finderUrl('https://x.org', { where: 'r:asia', approaches: ['species_conservation'] })).toBe('https://x.org/?approach=species_conservation&where=r:asia')
  })
  test("with it, opens the subscriber's country page, keeping a type no page holds", () => {
    const cr = pagePaths[pageKey('CR', '')]!
    expect(cr).toBe('/countries/costa-rica/')
    expect(finderUrl('https://x.org', { where: 'CR', approaches: [] }, pagePaths)).toBe(`https://x.org${cr}`)
    expect(finderUrl('https://x.org', { where: 'CR', approaches: ['mangroves'] }, pagePaths)).toBe(`https://x.org${cr}?approach=mangroves`)
    expect(finderUrl('https://x.org', { where: 'r:africa', approaches: [] }, pagePaths)).toBe(`https://x.org${pagePaths[pageKey('r:africa', '')]}`)
  })
})

describe('funder marks', () => {
  test('every stored mark has its email PNG (run bun scripts/images/email-icons.ts after sync-favicons)', () => {
    const missing = Object.values(marks).filter((m) => m.file && !existsSync(join(import.meta.dir, '../../public/icons/marks', `${m.domain}.png`)))
    expect(missing.map((m) => m.domain)).toEqual([])
  })
})

describe('email images', () => {
  test('every image a card can show is in public/: flags, type badges, the logo', () => {
    const site = 'https://naturefunding.org'
    const prefs = cleanPrefs('', [])
    const all = loadProgrammes()
    // Antarctica is a valid country code with no flag file: it must not ask for one.
    const aq = { ...all[0], geography: { scope: 'countries', countries: ['AQ'] } } as Programme
    const srcs = [...all, aq].flatMap((programme) => {
      const x = itemParts({ programme, section: 'new' } as DigestItem, site, prefs)
      return [...x.flags.map((c) => `flags/${c}.png`), ...x.types.map((t) => `icons/types/${t.key}-muted.png`)]
    })
    srcs.push('icons/logo.png')
    const missing = [...new Set(srcs)].filter((s) => !existsSync(join(import.meta.dir, '../../public', s)))
    expect(missing).toEqual([])
  })
})
