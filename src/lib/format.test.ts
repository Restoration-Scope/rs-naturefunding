import { describe, expect, test } from 'bun:test'
import { geographyFull, sentence } from './format'

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
