import { describe, expect, test } from 'bun:test'
import { boldFigures, geographyFull, sentence } from './format'

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
