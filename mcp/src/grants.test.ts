import { describe, expect, test } from 'bun:test'
import type { Programme } from '../../src/data/schema'
import { getGrant, searchGrants } from './grants'

const today = '2026-11-01'
const ev = { source_url: 'https://funder.example/call', quote: 'Applications close on 1 December 2026.', checked_at: today, method: 'page' }

function programme(id: string, over: Partial<Programme> = {}): Programme {
  return {
    id,
    name: `${id} grant`,
    funder: { name: 'Example Fund', url: 'https://funder.example/' },
    administered_by: null,
    parent: null,
    url: 'https://funder.example/call',
    summary: 'Grants for community groups restoring forests.',
    approaches: ['reforestation'],
    applicant_types: ['ngo'],
    geography: { scope: 'global' },
    access: 'direct',
    window: 'fixed',
    amount: null,
    co_finance_required: null,
    reporting: null,
    calls: [
      { id: 'c', label: '2026 round', url: 'https://funder.example/call', status: 'open', opens: null, deadline: { date: '2026-12-01', text: '1 December 2026' }, evidence: { status: ev } },
    ],
    evidence: {},
    checked_at: today,
    ...over,
  } as Programme
}

const closed = [{ id: 'c', label: '2025', url: 'https://funder.example/call', status: 'closed', opens: null, deadline: { date: '2025-06-01', text: '1 June 2025' }, evidence: { status: ev } }]

describe('searchGrants', () => {
  test('a country matches worldwide programmes, its own listing and its region, not other regions', () => {
    const ps = [
      programme('world'),
      programme('kenya', { geography: { scope: 'countries', countries: ['KE'] } }),
      programme('africa', { geography: { scope: 'regions', regions: ['africa'], whole: true, label: 'Africa' } }),
      programme('asia', { geography: { scope: 'regions', regions: ['asia'], label: 'Asia' } }),
    ]
    expect(searchGrants(ps, { country: 'ke' }, today).results.map((r) => r.id).sort()).toEqual(['africa', 'kenya', 'world'])
  })

  test('a region matches programmes with any country in it; an unknown place is an error, not everything', () => {
    const ps = [programme('kenya', { geography: { scope: 'countries', countries: ['KE'] } }), programme('peru', { geography: { scope: 'countries', countries: ['PE'] } })]
    expect(searchGrants(ps, { region: 'africa' }, today).results.map((r) => r.id)).toEqual(['kenya'])
    const bad = searchGrants(ps, { country: 'XX' }, today)
    expect([bad.total, typeof bad.error]).toEqual([0, 'string'])
  })

  test('as on the site, no stated place matches no country; an unstated applicant type is kept, last, to check', () => {
    const ps = [programme('nowhere', { geography: null }), programme('anyone', { applicant_types: null }), programme('world')]
    expect(searchGrants(ps, { country: 'KE' }, today).results.map((r) => r.id)).toEqual(['anyone', 'world'])
    const { results } = searchGrants(ps, { applicant_type: 'ngo' }, today)
    expect(results.map((r) => [r.id, r.check?.length ?? 0])).toEqual([
      ['nowhere', 0],
      ['world', 0],
      ['anyone', 1],
    ])
  })

  test('yearly windows the page doesn’t date are worth a look; programmes with no call are not', () => {
    const window = [{ id: 'w', label: 'Yearly', url: 'https://funder.example/call', status: 'unknown', opens: null, deadline: null, recurring: '15 October to 22 December', evidence: { status: ev, recurring: ev } }]
    const ps = [programme('window', { calls: window as never }), programme('nothing', { calls: [] })]
    const { results } = searchGrants(ps, {}, today)
    expect(results.map((r) => [r.id, r.recurring])).toEqual([['window', '15 October to 22 December']])
    expect(searchGrants(ps, { status: 'open' }, today).total).toBe(0)
    expect(searchGrants(ps, { status: 'any' }, today).total).toBe(2)
  })

  test('closed programmes are left out unless status is any', () => {
    const ps = [programme('open'), programme('closed', { calls: closed as never })]
    expect(searchGrants(ps, {}, today).results.map((r) => r.id)).toEqual(['open'])
    expect(searchGrants(ps, { status: 'any' }, today).total).toBe(2)
  })

  test('programmes unchecked for more than 90 days are not listed, as on the site', () => {
    const ps = [programme('stale', { checked_at: '2026-07-01' })]
    expect(searchGrants(ps, { status: 'any' }, today).total).toBe(0)
    expect(getGrant(ps, 'stale', today)).toBeNull()
  })

  test('a query matches word starts in the name, funder, summary and approach labels, accents ignored', () => {
    const ps = [programme('mangrove', { summary: 'Restauración de manglares y costas.', approaches: ['mangroves'] }), programme('forest')]
    expect(searchGrants(ps, { query: 'mangrove' }, today).results.map((r) => r.id)).toEqual(['mangrove'])
    expect(searchGrants(ps, { query: 'restauracion' }, today).results.map((r) => r.id)).toEqual(['mangrove'])
  })

  test('a result shows the deadline in the funder’s words and the page with the evidence', () => {
    const [r] = searchGrants([programme('one')], {}, today).results
    expect(r!.status).toBe('Open')
    expect(r!.deadline).toBe('2026-12-01 (funder\'s words: "1 December 2026")')
    expect(r!.page).toBe('https://naturefunding.org/p/one/')
    expect('opens' in r! || 'expected' in r! || 'recurring' in r!).toBe(false)
  })

  test('words every listing shares don’t match on their own; more matched words rank first', () => {
    const ps = [programme('forest'), programme('women', { summary: 'Seed grants for women-led groups restoring forests.' })]
    expect(searchGrants(ps, { query: 'grants for' }, today).total).toBe(2)
    const found = searchGrants(ps, { query: 'seed fund for women-led groups' }, today)
    expect(found.query_words).toEqual(['seed', 'women', 'led', 'groups'])
    expect(found.results.map((r) => [r.id, r.matched])).toEqual([
      ['women', ['seed', 'women', 'led', 'groups']],
      ['forest', ['groups']],
    ])
  })

  test('40 results by default, at most 100, paged with offset', () => {
    const ps = Array.from({ length: 110 }, (_, i) => programme(`p${String(i).padStart(3, '0')}`))
    expect(searchGrants(ps, {}, today).results).toHaveLength(40)
    expect(searchGrants(ps, { limit: 500 }, today).results).toHaveLength(100)
    expect(searchGrants(ps, { offset: 108 }, today).results.map((r) => r.id)).toEqual(['p108', 'p109'])
  })
})

describe('getGrant', () => {
  test('the status follows the calls for the country asked about', () => {
    const call = (id: string, countries: string[], deadline: string) => ({ id, label: id, url: 'https://funder.example/call', status: 'open', opens: null, countries, deadline: { date: deadline, text: deadline }, evidence: { status: ev, countries: ev } })
    const p = programme('split', { calls: [call('peru', ['PE'], '2026-12-20'), call('kenya', ['KE'], '2026-12-05')] as never })
    expect(getGrant([p], 'split', today, { country: 'PE' })!.deadline).toStartWith('2026-12-20')
    expect(getGrant([p], 'split', today)!.deadline).toStartWith('2026-12-05')
  })

  test('returns the summary with its labels, and null for an unknown id', () => {
    const g = getGrant([programme('one'), programme('child', { parent: 'one' })], 'one', today)
    expect([g!.status, g!.approaches, g!.partner_programmes]).toEqual(['Open', ['Reforestation'], [{ id: 'child', name: 'child grant' }]])
    expect(getGrant([programme('one')], 'two', today)).toBeNull()
  })
})
