import { describe, expect, test } from 'bun:test'
import { amountShort, boldFigures, effortLevel, effortSignals, geographyFull, sentence } from './format'

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

describe('effortLevel', () => {
  const steps = (n: number) => Array.from({ length: n }, (_, i) => `Step ${i + 1}`)
  test('needs the steps', () => expect(effortLevel({ effort: undefined, documents: ['A'] })).toBeNull())
  test('one step with few documents is light', () =>
    expect(effortLevel({ effort: { steps: steps(1) }, documents: ['A', 'B'] })).toEqual({ level: 'Light', why: '1 step, 2 documents' }))
  test('two steps is medium', () => expect(effortLevel({ effort: { steps: steps(2) }, documents: undefined })).toEqual({ level: 'Medium', why: '2 steps, documents not listed' }))
  test('three stages or five documents is heavy', () => {
    expect(effortLevel({ effort: { steps: steps(2), more_after: true }, documents: undefined })?.level).toBe('Heavy')
    expect(effortLevel({ effort: { steps: steps(1) }, documents: ['A', 'B', 'C', 'D', 'E'] })?.level).toBe('Heavy')
  })
})

describe('effortSignals', () => {
  const none = {
    eligibility: undefined,
    effort: undefined,
    documents: undefined,
    co_finance_required: null,
    co_finance: undefined,
    consortium_required: undefined,
    after_award: undefined,
    requirements_checked: undefined,
  }
  const levels = (p: Parameters<typeof effortSignals>[0]) => effortSignals(p).map((s) => s.level)
  test('a listing not read for requirements yet is unchecked, never light', () =>
    expect(levels(none)).toEqual(['unchecked', 'unchecked', 'unchecked', 'unchecked']))
  test('once read, absent facts are unstated, never light', () =>
    expect(levels({ ...none, requirements_checked: '2026-11-16' })).toEqual(['unstated', 'unstated', 'unstated', 'unstated']))
  test('a stated co-funding answer counts even before the read', () =>
    expect(levels({ ...none, co_finance_required: false })[2]).toBe('light'))
  test('a finance bar, a big match, quarterly reports and audits are heavy', () => {
    const s = effortSignals({
      ...none,
      eligibility: [{ rule: 'Average yearly revenue over €60,000', kind: 'finances' }],
      co_finance_required: true,
      co_finance: { min_share: 50, in_kind: true },
      after_award: { reports: 'yearly', audit: true },
    })
    expect(s.map((x) => x.level)).toEqual(['heavy', 'unchecked', 'heavy', 'heavy'])
    expect(s[0]!.why).toBe('1 rule, with finances requirements.')
    expect(s[2]!.why).toBe('At least 50% of the project, in-kind accepted.')
    expect(s[3]!.why).toBe('Yearly reports and an audit.')
  })
  test('a stated ratio is shown as stated and sets the level by its share', () => {
    const s = effortSignals({ ...none, co_finance_required: true, co_finance: { ratio: '1:2' } })
    expect(s[2]).toMatchObject({ level: 'heavy', why: '1 of yours for every 2 from the funder.' })
    expect(levels({ ...none, co_finance_required: true, co_finance: { ratio: '1:4' } })[2]).toBe('some')
  })
  test('applying says when the documents are not listed', () =>
    expect(effortLevel({ effort: { steps: ['Online form'] }, documents: undefined })?.why).toBe('1 step, documents not listed'))
  test('the number of rules does not change the level, only their kind', () => {
    const cap = (n: number) => Array.from({ length: n }, (_, i) => ({ rule: `Staff rule ${i + 1}`, kind: 'capacity' as const }))
    expect(levels({ ...none, eligibility: cap(1) })[0]).toBe('some')
    expect(levels({ ...none, eligibility: cap(4) })[0]).toBe('some')
  })
  test('a consortium, a fixed match or interim reports are some; one final report is light', () => {
    const s = effortSignals({
      ...none,
      eligibility: [{ rule: 'Registered locally', kind: 'legal' }],
      consortium_required: true,
      co_finance_required: true,
      co_finance: { min_amount: { value: 5000, currency: 'EUR' }, applies_to: 'Private companies' },
      after_award: { reports: 'interim_and_final' },
    })
    expect(s.map((x) => x.level)).toEqual(['some', 'unchecked', 'some', 'some'])
    expect(s[0]!.why).toBe('1 rule, with a consortium.')
    expect(s[2]!.why).toBe('At least 5,000 EUR (Private companies).')
    expect(levels({ ...none, after_award: { reports: 'final' } })[3]).toBe('light')
    expect(levels({ ...none, after_award: { reports: 'other' } })[3]).toBe('some')
    expect(levels({ ...none, eligibility: [{ rule: 'Registered locally', kind: 'legal' }] })[0]).toBe('light')
  })
})
