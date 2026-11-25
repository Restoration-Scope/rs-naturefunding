import { describe, expect, test } from 'bun:test'
import type { Call, Programme } from '../data/schema'
import { statusText } from './agent'
import { callGroups, listingFor, openPartners, partnerGroups, programmeById, programmes } from './data'
import { finderPages } from './finder-pages'
import { callTakes, placeFit } from './where-codes'
import { partsFor } from './where-view'
import { withRegions } from './geo'

const faf = programmeById.get('forest-action-facility')!
const call = (id: string, status: Call['status'], countries?: string[]): Call => ({
  ...faf.calls[0]!,
  id,
  status,
  deadline: null,
  opens: null,
  expected: undefined,
  countries,
})
const withCalls = (calls: Call[], geography: Programme['geography'] = faf.geography): Programme => ({ ...faf, geography, calls })
const shape = (p: Programme) => callGroups(p).map((g) => [g.codes?.join(' ') ?? '*', g.listing.state, g.listing.call?.id])

describe('call groups', () => {
  test('Forest Action Facility: one group per country window, each with its own call', () => {
    // Sorted by codes: the order follows the calls' states, which move with the build date.
    expect(callGroups(faf).map((g) => [g.codes?.join(' '), g.listing.call?.id]).sort()).toEqual([
      ['BZ CR SV GT HN PA', 'central-america-first-call'],
      ['EC', 'ecuador-2026'],
      ['PE', 'peru-first-call'],
    ])
  })

  test('overlapping calls: each country gets its own best call', () => {
    const p = withCalls([call('shared', 'upcoming', ['CR', 'EC']), call('ecuador', 'open', ['EC'])], { scope: 'countries', countries: ['CR', 'EC'] })
    expect(shape(p)).toEqual([
      ['EC', 'open', 'ecuador'],
      ['CR', 'upcoming', 'shared'],
    ])
  })

  test('a call for every country next to groups that cover them all adds no empty rest', () => {
    const p = withCalls([call('all', 'closed'), call('cr', 'open', ['CR'])], { scope: 'countries', countries: ['CR', 'EC'] })
    expect(shape(p)).toEqual([
      ['CR', 'open', 'cr'],
      ['EC', 'closed', 'all'],
    ])
  })

  test('a programme open to regions keeps a rest group for the countries no call names', () => {
    const p = withCalls([call('kenya', 'open', ['KE'])], { scope: 'regions', regions: ['africa'], label: 'Africa' })
    expect(shape(p)).toEqual([
      ['KE', 'open', 'kenya'],
      ['*', 'none', undefined],
    ])
  })

  test('no call names countries, or every country gets the same: no groups', () => {
    expect(callGroups(withCalls([call('all', 'open')]))).toEqual([])
    expect(callGroups(withCalls([call('all', 'open', ['CR', 'EC'])], { scope: 'countries', countries: ['CR', 'EC'] }))).toEqual([])
  })
})

describe('a place page reports only the calls that take the place', () => {
  const places = [...finderPages.countries, ...finderPages.regions]
  const ecuador = finderPages.countries.find((p) => p.iso2 === 'EC')!

  test('no row’s status comes from a call for other countries', () => {
    const wrong = places.flatMap((pg) =>
      [...pg.listings, ...pg.check].filter((l) => l.where !== pg.where || (l.call && !callTakes(l.call, pg.where))).map((l) => `${pg.path} ${l.p.id}`),
    )
    expect(wrong).toEqual([])
  })

  test('Ecuador: Forest Action Facility’s row is Ecuador’s own, not Central America’s', () => {
    const p = withCalls([call('ec', 'closed', ['EC']), call('cr', 'upcoming', ['CR'])])
    expect([listingFor(p, undefined, 'EC'), listingFor(p, undefined, 'CR')].map((l) => [l.state, l.call?.id])).toEqual([['closed', 'ec'], ['upcoming', 'cr']])
    // Absent once the listing goes too long without a check.
    const row = ecuador.listings.find((l) => l.p.id === faf.id)
    if (row) expect(row).toEqual(listingFor(faf, undefined, 'EC'))
  })

  test('partner programmes count as open only where they take the place', () => {
    for (const pg of places) {
      for (const l of pg.listings.filter((x) => x.p.access === 'intermediary')) {
        const open = programmes.filter((c) => c.parent === l.p.id && placeFit(c, pg.where) === 'all' && ['open', 'rolling'].includes(listingFor(c, undefined, pg.where).state))
        const said = statusText(l).match(/(One|\d+) partner programmes? (?:is|are) open/i)?.[1]
        expect([pg.path, l.p.id, said ? Number(said.replace(/one/i, '1')) : 0]).toEqual([pg.path, l.p.id, open.length])
      }
    }
  })

  test('the status line names the place when the programme has calls for others, and counts no others as open', () => {
    const p = withCalls([call('cr', 'open', ['CR']), call('pe', 'open', ['PE']), call('ec', 'closed', ['EC'])])
    expect(statusText(listingFor(p, undefined, 'EC'))).toStartWith('No call open now for Ecuador. The last call we found has closed')
    expect(statusText(listingFor(p, undefined, 'PA'))).toBe('No open or announced call for Panama found on the funder’s page.')
    expect(statusText(listingFor(p, undefined, 'CR'))).not.toContain('more call')
    expect(statusText(listingFor(p))).toContain('One more call is open')
  })

  test('a finder row counts the same partners for each country as its page', () => {
    for (const p of programmes.filter((x) => x.access === 'intermediary')) {
      for (const g of partnerGroups(p)) for (const c of g.codes) expect([p.id, c, openPartners(p, c).length]).toEqual([p.id, c, g.open])
    }
  })

  test('the apply box shows a region the parts with a country in it, and the rest’s', () => {
    const parts = ['KE', 'EC PE', '*'].map((c) => withRegions(c).split(' ').filter((x) => x !== ''))
    expect([partsFor(parts, 'KE'), partsFor(parts, 'CR'), partsFor(parts, 'r:africa'), partsFor(parts, 'r:latin_america_caribbean'), partsFor(parts, 'r:asia')]).toEqual([[0], [2], [0, 2], [1, 2], [2]])
  })

  test('a region takes a call for any of its countries', () => {
    const cr = call('cr', 'open', ['CR'])
    expect([callTakes(cr, 'r:latin_america_caribbean'), callTakes(cr, 'r:africa'), callTakes(cr, ''), callTakes(call('all', 'open'), 'r:africa')]).toEqual([true, false, true, true])
  })
})
