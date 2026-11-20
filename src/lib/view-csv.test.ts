import { describe, expect, test } from 'bun:test'
import { csvFields, csvFileName, csvRecords, pickProgrammes } from './view-csv'

const header = 'programme_id,programme,call_id,call_note'
const rows = ['a,Alpha,,', 'b,Beta,b-2025,"two\nlines, quoted ""here"""', 'b,Beta,b-2026,this year', 'c,Gamma,c-1,']
const csv = [header, ...rows, ''].join('\n')

describe('csvRecords', () => {
  test('keeps newlines inside quoted cells', () => {
    expect(csvRecords(csv)).toEqual([header, ...rows])
  })
})

describe('csvFields', () => {
  test('unquotes cells with commas, quotes and newlines', () => {
    expect(csvFields(rows[1]!)).toEqual(['b', 'Beta', 'b-2025', 'two\nlines, quoted "here"'])
  })
})

describe('pickProgrammes', () => {
  test('one row per shown programme, the call its row shows, in view order', () => {
    expect(pickProgrammes(csv, [{ id: 'c', call: 'c-1' }, { id: 'b', call: 'b-2026' }, { id: 'a' }])).toBe(
      [header, 'c,Gamma,c-1,', 'b,Beta,b-2026,this year', 'a,Alpha,,', ''].join('\n'),
    )
  })
  test('a row showing no call takes the first record', () => {
    expect(pickProgrammes(csv, [{ id: 'b' }])).toBe([header, 'b,Beta,b-2025,"two\nlines, quoted ""here"""', ''].join('\n'))
  })
  test('a call or programme no longer in the file gives null, so the reader reloads', () => {
    expect(pickProgrammes(csv, [{ id: 'c', call: 'gone' }])).toBeNull()
    expect(pickProgrammes(csv, [{ id: 'z' }])).toBeNull()
  })
  test('no programmes shown gives the header alone', () => {
    expect(pickProgrammes(csv, [])).toBe(`${header}\n`)
  })
})

describe('csvFileName', () => {
  test('names the page and date', () => {
    expect(csvFileName('/', '2026-11-20')).toBe('naturefunding-2026-11-20.csv')
    expect(csvFileName('/countries/kenya/', '2026-11-20')).toBe('naturefunding-countries-kenya-2026-11-20.csv')
  })
})
