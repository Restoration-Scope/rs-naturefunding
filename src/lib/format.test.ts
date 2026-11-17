import { describe, expect, test } from 'bun:test'
import { amountShort, boldFigures, geographyFull, nameWithFunder, programmeTitle, sentence } from './format'
import { inPlace, placeTitle } from './finder-pages'

describe('geographyFull', () => {
  test('a region label that is the region name is not repeated', () => {
    expect(geographyFull({ scope: 'regions', label: 'Africa', regions: ['africa'] } as never)).toBe('Africa')
  })

  test('a funder label that differs keeps the region list', () => {
    expect(geographyFull({ scope: 'regions', label: 'Sub-Saharan Africa', regions: ['africa'] } as never)).toBe('Sub-Saharan Africa (Africa)')
  })
})

describe('sentence', () => {
  test('adds a full stop only when missing', () => {
    expect(sentence('Limits are not specified.')).toBe('Limits are not specified.')
    expect(sentence('Limits are not specified')).toBe('Limits are not specified.')
    expect(sentence('Is it open?')).toBe('Is it open?')
  })
})

describe('amountShort', () => {
  test('short figures, a sign where the currency has one, per project', () => {
    expect(amountShort({ currency: 'EUR', min: 5e6, max: 2e7 })?.text).toBe('€5M–€20M per project')
    expect(amountShort({ currency: 'USD', min: 5000, max: 15000, typical: true })?.text).toBe('Usually $5K–$15K per project')
    expect(amountShort({ currency: 'GBP', max: 3000 })?.text).toBe('Up to £3K per project')
    expect(amountShort({ currency: 'JPY', max: 1e6, per: 'year' })?.text).toBe('Up to ¥1M per project a year')
    expect(amountShort({ currency: 'CZK', min: 50000, max: 200000 })?.text).toBe('CZK 50K–200K per project')
    expect(amountShort({ currency: 'EUR', max: 45, unit: 'tree' })?.text).toBe('Up to €45 per tree')
  })
  test('converted to the reader’s currency, with the funder’s own figure kept', () => {
    const a = amountShort({ currency: 'EUR', min: 5e6, max: 2e7 }, 'USD')!
    expect(a.text).toMatch(/^About \$\d.*–\$\d+M per project$/)
    expect(a.original).toBe('€5M–€20M')
    expect(amountShort({ currency: 'USD', max: 5000 }, 'USD')).toEqual({ text: 'Up to $5K per project', original: null })
    expect(amountShort({ currency: 'USD', max: 5000 }, 'XYZ')?.original).toBeNull()
  })
})

describe('boldFigures', () => {
  const b = (s: string) => `<strong class="font-bold text-ink">${s}</strong>`
  test('bolds sums, ranges and shares, not years', () => {
    expect(boldFigures('between EUR 2 - 4 million, up to €5,000,000')).toBe(`between ${b('EUR 2 - 4 million')}, up to ${b('€5,000,000')}`)
    expect(boldFigures('at least 25% of costs')).toBe(`at least ${b('25%')} of costs`)
    expect(boldFigures('up to Nu. 6.0 million for 2026')).toBe(`up to ${b('Nu. 6.0 million')} for 2026`)
  })
  test('escapes the text around the figures', () => {
    expect(boldFigures('<b> & 10')).toBe(`&lt;b&gt; &amp; ${b('10')}`)
  })
})

describe('nameWithFunder', () => {
  const p = (name: string, funder: string) => ({ name, funder: { name: funder, url: 'https://example.org' } })
  test('names the programme and its funder', () => {
    expect(nameWithFunder(p('Darwin Initiative Main', 'Defra'))).toBe('Darwin Initiative Main, Defra')
  })
  test('says the name once when the funder repeats it', () => {
    expect(nameWithFunder(p('Scottish Rivers Fund', 'Scottish Rivers Fund'))).toBe('Scottish Rivers Fund')
    expect(nameWithFunder(p('Forest Action Facility', 'Forest Action Facility (established by IUCN and KfW)'))).toBe(
      'Forest Action Facility (established by IUCN and KfW)',
    )
  })
})

describe('programmeTitle', () => {
  type A = NonNullable<Parameters<typeof programmeTitle>[0]['amount']>
  const p = (name: string, funder: string, amount?: Partial<A>) => ({
    name,
    funder: { name: funder, url: 'https://example.org' },
    amount: amount ? ({ currency: 'GBP', ...amount } as A) : null,
  })
  test('names the programme, its funder and what it pays', () => {
    expect(programmeTitle(p('Darwin Initiative Main', 'Defra', { min: 200000, max: 1000000 }))).toBe('Darwin Initiative Main, Defra: £200K–£1M')
  })
  test("uses the funder's own short form", () => {
    expect(programmeTitle(p('IKI Small Grants', 'International Climate Initiative (IKI)', { currency: 'EUR', min: 60000, max: 200000 }))).toBe(
      'IKI Small Grants: €60K–€200K',
    )
  })
  test('says the name once when the funder repeats it', () => {
    expect(programmeTitle(p('Forest Action Facility', 'Forest Action Facility (established by IUCN and KfW)'))).toBe('Forest Action Facility')
  })
  test('drops the funder before the amount when a named programme runs long', () => {
    expect(programmeTitle(p('Rufford Small Grants', 'The Rufford Foundation for Nature Conservation Worldwide', { min: 7000, max: 18000 }))).toBe(
      'Rufford Small Grants: £7K–£18K',
    )
  })
  test('keeps the funder beside a generic name', () => {
    const t = programmeTitle(p('Small Grants', 'A Very Long Named Foundation for Nature and People Everywhere', { min: 1000, max: 5000 }))
    expect(t).toBe('Small Grants, A Very Long Named Foundation for Nature and People Everywhere')
  })
  test('keeps a currency code in capitals', () => {
    expect(programmeTitle(p('EAMCEF Grants', 'Eastern Arc Mountains Conservation Endowment Fund (EAMCEF)', { currency: 'TZS', min: 1e7, max: 1e8, per: 'year' }))).toBe(
      'EAMCEF Grants: TZS 10M–100M a year',
    )
  })
})

describe('placeTitle', () => {
  test('adds "the" where English needs it', () => {
    expect(inPlace('United Kingdom')).toBe('the United Kingdom')
    expect(inPlace('Kenya')).toBe('Kenya')
  })
  test('adds the topic when it fits in a search result', () => {
    expect(placeTitle('Kenya')).toBe('Grants and funding for NGOs in Kenya: nature conservation')
    expect(placeTitle('United States')).toBe('Grants and funding for NGOs in the United States')
  })
})
