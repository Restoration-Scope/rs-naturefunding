import { describe, expect, test } from 'bun:test'
import { amountCell, compactAmount } from './table'

describe('compactAmount', () => {
  test('the funder’s figures, shortened', () => {
    expect(compactAmount({ currency: 'USD', min: 250000 })).toBe('From $250k USD')
    expect(compactAmount({ currency: 'EUR', min: 250000, max: 800000, typical: true })).toBe('Usually €250k–€800k EUR')
    expect(compactAmount({ currency: 'USD', max: 250000, max_exclusive: true })).toBe('Less than $250k USD')
    expect(compactAmount({ currency: 'USD', max: 250000, typical: true })).toBe('Usually up to $250k USD')
    expect(compactAmount({ currency: 'GBP', max: 3000, per: 'year' })).toBe('Up to £3k GBP a year')
    expect(compactAmount({ currency: 'EUR', max: 45, unit: 'tree' })).toBe('Up to €45 EUR per tree')
  })
})

describe('amountCell', () => {
  test('converts, with the funder’s figure as the original', () => {
    const c = amountCell({ currency: 'EUR', min: 250000, max: 800000, typical: true }, 'USD')!
    expect(c.text).toMatch(/^Usually about \$\d+k–⁠\$\d+k USD$/)
    expect(c.original).toBe('€250k–⁠€800k EUR')
    expect(amountCell({ currency: 'JPY', max: 8e6 }, 'USD')!.original).toBe('¥8m JPY')
    expect(amountCell({ currency: 'EUR', min: 1e5, max: 1e5, per: 'year' }, 'USD')!.original).toBe('€100k EUR a year')
  })
  test('same currency, none, or no rate: the funder’s figure alone', () => {
    expect(amountCell({ currency: 'USD', min: 250000 }, 'USD')).toEqual({ text: 'From $250k USD', original: null })
    expect(amountCell({ currency: 'USD', min: 250000 })).toEqual({ text: 'From $250k USD', original: null })
    expect(amountCell({ currency: 'USD', min: 250000 }, 'XXX')!.original).toBeNull()
    expect(amountCell(null, 'USD')).toBeNull()
  })
  test('the lead word comes before “about”', () => {
    expect(amountCell({ currency: 'EUR', max: 100000 }, 'USD')!.text).toMatch(/^Up to about \$\d/)
    expect(amountCell({ currency: 'EUR', min: 100000 }, 'USD')!.text).toMatch(/^From about \$\d/)
    expect(amountCell({ currency: 'EUR', min: 100000, max: 100000 }, 'USD')!.text).toMatch(/^About \$\d/)
    expect(amountCell({ currency: 'USD', min: 1e6 }, 'JPY')!.text).toMatch(/^From about ¥\d+(\.\d)?m JPY$/)
  })
})
