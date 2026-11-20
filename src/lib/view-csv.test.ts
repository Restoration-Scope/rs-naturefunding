import { describe, expect, test } from 'bun:test'
import { csvFileName, csvRecords, pickProgrammes } from './view-csv'

const csv = ['programme_id,programme,call_note', 'a,Alpha,', 'b,Beta,"two\nlines, quoted ""here"""', 'b,Beta,second call', 'c,Gamma,', ''].join('\n')

describe('csvRecords', () => {
  test('keeps newlines inside quoted cells', () => {
    expect(csvRecords(csv)).toEqual(['programme_id,programme,call_note', 'a,Alpha,', 'b,Beta,"two\nlines, quoted ""here"""', 'b,Beta,second call', 'c,Gamma,'])
  })
})

describe('pickProgrammes', () => {
  test('keeps the header and every call of the shown programmes, in view order', () => {
    expect(pickProgrammes(csv, ['c', 'b'])).toBe(
      ['programme_id,programme,call_note', 'c,Gamma,', 'b,Beta,"two\nlines, quoted ""here"""', 'b,Beta,second call', ''].join('\n'),
    )
  })
  test('no programmes shown gives the header alone', () => {
    expect(pickProgrammes(csv, [])).toBe('programme_id,programme,call_note\n')
  })
})

describe('csvFileName', () => {
  test('names the page and date', () => {
    expect(csvFileName('/', '2026-11-20')).toBe('naturefunding-2026-11-20.csv')
    expect(csvFileName('/countries/kenya/', '2026-11-20')).toBe('naturefunding-countries-kenya-2026-11-20.csv')
  })
})
