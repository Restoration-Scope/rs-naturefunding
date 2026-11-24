import { describe, expect, test } from 'bun:test'
import type { Programme } from '../data/schema'
import { geographyIssues } from '../data/geography'
import { countryLists, programmeById, whereArea, whereReach } from './data'
import { finderPages } from './finder-pages'
import { geographyFull, placeNote } from './format'
import { areaCountries, areaNames, countryRegion } from './geo'
import { placeFit } from './where-codes'

const reach = (id: string) => new Set(whereReach(programmeById.get(id)!).split(' '))
const geo = (geography: Programme['geography']) => ({ geography }) as Programme

describe('whether a programme page says it takes a country', () => {
  test('a funder group with an official list takes only the countries on it', () => {
    expect(reach('iki-small-grants').has('KE')).toBe(true)
    expect(reach('iki-small-grants').has('DE')).toBe(false)
  })

  test('a funder group with no list is a maybe for every country in its regions, never a yes', () => {
    const r = reach('neaq-mcaf')
    expect(r.has('?MD')).toBe(true)
    expect(r.has('MD')).toBe(false)
    expect(r.has('R:europe')).toBe(false)
  })

  test('a whole region takes each of its countries, but for the ones the funder leaves out', () => {
    expect(reach('lion-recovery-fund').has('KE')).toBe(true)
    expect(placeFit(programmeById.get('stiftung-artenschutz-small-grants')!, 'FJ')).toBe('all')
    expect(placeFit(programmeById.get('stiftung-artenschutz-small-grants')!, 'NZ')).toBe(null)
  })

  test.each([
    'iucn-best',
    'ellerman-ukots-fund',
    'sadc-tfca-financing-facility',
    'dimfe-call-for-projects',
    'seh-grant-in-herpetology',
    'ffem-ppi',
  ])('%s is nowhere on the Kenya page', (id) => {
    const kenya = finderPages.countries.find((p) => p.iso2 === 'KE')!
    expect([...kenya.listings, ...kenya.check].map((l) => l.p.id)).not.toContain(id)
  })

  test('a grant for parks says so on each of its countries’ rows, once on its own page', () => {
    const g = programmeById.get('sadc-tfca-financing-facility')!.geography
    expect(placeNote(g, 'ZA')).toBe('Only its Transfrontier Conservation Areas')
    expect(geographyFull(g)).not.toContain('only')
  })

  test('a page’s count holds only the programmes sure to take the country', () => {
    const egypt = finderPages.countries.find((p) => p.iso2 === 'EG')!
    const ids = (ls: typeof egypt.listings) => ls.map((l) => l.p.id)
    expect(ids(egypt.check)).toContain('dimfe-call-for-projects')
    expect(ids(egypt.listings)).not.toContain('dimfe-call-for-projects')
    expect(egypt.lead).toContain(`${egypt.listings.length} grants`)
    expect(egypt.lead).toContain(`${egypt.check.length} more fund a group that may include Egypt`)
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

describe('a listing can’t claim a place its funder doesn’t name', () => {
  const problems = (g: unknown, quote = 'q') =>
    geographyIssues({ geography: g, evidence: { geography: { quote } } } as unknown as Programme, countryLists)
  const regions = (label: string, rs: string[], more = {}) => ({ scope: 'regions', regions: rs, label, ...more })

  test.each([
    ['a group that doesn’t say where it can be', regions('Coral reef sites', ['africa']), 'say whether'],
    ['a closed set of territories', regions('EU outermost regions', ['africa'], { areas: ['RE'] }), 'set of countries someone lists'],
    ['an official group', regions('ODA-eligible countries', ['africa'], { areas: ['africa'] }), 'set of countries someone lists'],
    ['a basin mapped to whole regions', regions('Mediterranean basin', ['africa', 'europe'], { areas: ['africa', 'europe'] }), 'smaller than a region'],
    ['part of a region mapped to all of it', regions('West and Central Africa', ['africa'], { areas: ['africa'] }), 'smaller than a region'],
    ['a smaller place marked whole', regions('Southern Africa', ['africa'], { whole: true }), 'whole claims every country'],
    ['a group marked whole', regions('Developing countries in Africa', ['africa'], { whole: true }), 'whole claims every country'],
    ['a region the label doesn’t name marked whole', regions('Across Africa', ['africa', 'asia'], { whole: true }), 'whole claims all of asia'],
    ['areas outside the regions', regions('Southeast Asia', ['africa'], { areas: ['southeast_asia', 'KE'] }), 'areas reaches asia'],
    ['a country list missing a listed country', { scope: 'countries', countries: ['KE'], label: 'ODA', list: 'dac-oda-recipients' }, 'countries lacks'],
    ['a country its list lacks', { scope: 'countries', countries: [...countryLists.get('osme-region')!.countries, 'DE'], label: 'OSME', list: 'osme-region' }, 'countries adds DE'],
    ['a smaller place with its region whole', regions('Southern Africa', ['africa'], { whole: ['africa'] }), 'whole claims all of africa'],
    ['a narrow code beside a whole region', regions('Mediterranean basin', ['africa'], { areas: ['africa', 'EG'] }), 'smaller than a region'],
    ['a named country the words don’t name', regions('A developing country', ['africa', 'oceania'], { areas: ['africa'], named: ['NZ'] }), 'named holds NZ'],
    ['a part of a country it doesn’t take', { scope: 'countries', countries: ['GL'], parts: { PT: 'the Azores' } }, 'parts names PT'],
  ])('%s', (_, g, want) => expect(problems(g).join('\n')).toContain(want))

  test('a country named in the quote may be named; one only in the label may not', () => {
    const g = regions('New Zealand or a developing country', ['africa', 'oceania'], { areas: ['africa'], named: ['NZ'] })
    expect(problems(g, 'Be based in New Zealand or in a developing country')).toEqual([])
    expect(problems(g, 'developing countries').join()).toContain('named holds NZ')
    expect(problems({ ...g, except: ['NZ'] }, 'New Zealand').join()).toContain('both named and except')
  })

  test.each([
    ['a quote that names less than the label', regions('Across Africa', ['africa'], { whole: true }), 'Projects in Southern Africa', 'names only a part'],
    ['a country the words leave out', regions('Across Africa', ['africa'], { whole: true }), 'Across Africa except Kenya', 'name KE'],
    ['a short closed set', regions('African countries', ['africa'], { areas: ['africa'] }), 'Only Kenya and Uganda are eligible', 'closes a set'],
  ])('%s', (_, g, quote, want) => expect(problems(g, quote).join()).toContain(want))

  test('a country named beside a group is covered; the group stays to check', () => {
    expect(placeFit(programmeById.get('auckland-zoo-small-grants')!, 'NZ')).toBe('all')
    expect(placeFit(programmeById.get('auckland-zoo-small-grants')!, 'FJ')).toBe('check')
  })

  test('the closed set may be in the quote alone', () => {
    expect(problems(regions('Islands', ['africa'], { areas: ['RE'] }), 'in the Overseas Countries and Territories').join()).toContain('set of countries')
  })

  test.each([
    regions('Across Africa', ['africa'], { whole: true }),
    regions('Mediterranean basin', ['europe', 'africa', 'middle_east'], { areas: ['mediterranean_basin'] }),
    regions('Europe and the Mediterranean basin', ['europe', 'africa', 'middle_east'], { whole: ['europe'], areas: ['mediterranean_basin'] }),
    regions('Developing countries', ['africa', 'asia'], { areas: ['africa', 'asia'] }),
    regions('Latin America and the Caribbean', ['latin_america_caribbean'], { whole: true }),
  ])('%o passes', (g) => expect(problems(g)).toEqual([]))

  test('every named area holds countries the finder lists', () => {
    for (const a of areaNames) expect([a, areaCountries(a).filter((c) => !countryRegion[c])]).toEqual([a, []])
  })
})

describe('official country lists', () => {
  // A country that left a list must leave every programme that points to it: this fails until the data says so.
  test('no list still holds a country past the day it leaves', () => {
    const today = new Date().toISOString().slice(0, 10)
    for (const list of countryLists.values()) {
      const left = Object.entries(list.leaves ?? {}).filter(([c, day]) => day <= today && list.countries.includes(c))
      expect([list.id, left]).toEqual([list.id, []])
      for (const p of programmeById.values()) {
        if (p.geography?.scope !== 'countries' || ![p.geography.list].flat().includes(list.id)) continue
        const g = p.geography
        expect([p.id, Object.entries(list.leaves ?? {}).filter(([c, day]) => day <= today && g.countries.includes(c))]).toEqual([p.id, []])
      }
    }
  })
})
