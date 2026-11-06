import { describe, expect, test } from 'bun:test'
import { amountShort, geographyFull, sentence } from './format'

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
