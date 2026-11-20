import { describe, expect, test } from 'bun:test'
import type { Programme } from '../data/schema'
import { countryLists, programmeById, whereArea, whereReach } from './data'

const reach = (id: string) => new Set(whereReach(programmeById.get(id)!).split(' '))
const geo = (geography: Programme['geography']) => ({ geography }) as Programme

describe('whether a programme page says it takes a country', () => {
  test('a funder group with an official list takes only the countries on it', () => {
    expect(reach('iki-small-grants').has('KE')).toBe(true)
    expect(reach('iki-small-grants').has('DE')).toBe(false)
  })

  test('a funder group with no list is a maybe for every country in its regions, never a yes', () => {
    const r = reach('rufford-small-grants')
    expect(r.has('?DE')).toBe(true)
    expect(r.has('DE')).toBe(false)
    expect(r.has('R:europe')).toBe(false)
  })

  test('a whole region takes each of its countries', () => {
    expect(reach('lion-recovery-fund').has('KE')).toBe(true)
  })

  test.each([
    [{ scope: 'countries', countries: ['JP'], label: 'Yamanashi Prefecture' }, { part: 'Yamanashi Prefecture' }],
    [{ scope: 'countries', countries: ['DK'], label: 'Denmark' }, {}],
    [{ scope: 'countries', countries: ['US'], label: 'All 50 states and DC', whole: true }, {}],
    [{ scope: 'countries', countries: ['HK', 'MO'], label: 'Hong Kong & Macao' }, {}],
    [{ scope: 'countries', countries: ['CO', 'EC', 'PE'], label: 'Tropical Andes' }, { within: 'Tropical Andes' }],
    [{ scope: 'countries', countries: ['CO'] }, {}],
  ] as const)('%o reads as %o', (g, want) => expect(whereArea(geo(g as unknown as Programme['geography']))).toEqual(want))
})

describe('official country lists', () => {
  // A country that left a list must leave every programme that points to it: this fails until the data says so.
  test('no list still holds a country past the day it leaves', () => {
    const today = new Date().toISOString().slice(0, 10)
    for (const list of countryLists.values()) {
      const left = Object.entries(list.leaves ?? {}).filter(([c, day]) => day <= today && list.countries.includes(c))
      expect([list.id, left]).toEqual([list.id, []])
      for (const p of programmeById.values()) {
        if (p.geography?.scope !== 'countries' || p.geography.list !== list.id) continue
        const g = p.geography
        expect([p.id, Object.entries(list.leaves ?? {}).filter(([c, day]) => day <= today && g.countries.includes(c))]).toEqual([p.id, []])
      }
    }
  })
})
