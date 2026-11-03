import { describe, expect, test } from 'bun:test'
import type { Call, Programme } from '../data/schema'
import { callGroups, programmeById } from './data'

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
