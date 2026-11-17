import { describe, expect, test } from 'bun:test'
import { programme, statesDate, statesYear, type Programme } from '../../src/data/schema'
import { checkData } from '../../src/data/load'
import { comparable, quoteOnPage } from '../../src/data/text'
import { htmlToText } from './page-text'

const URL = 'https://funder.example/call'
const ev = (quote: string, checked_at = '2026-11-01') => ({ source_url: URL, quote, checked_at, method: 'page' as const })

function fixture(): Programme {
  return {
    id: 'example-fund',
    name: 'Example Fund',
    funder: { name: 'Example Foundation', url: 'https://funder.example/' },
    administered_by: null,
    parent: null,
    url: URL,
    summary: 'Grants for community groups restoring mangroves along tropical coasts.',
    approaches: ['mangroves'],
    applicant_types: null,
    geography: null,
    access: 'direct',
    window: 'fixed',
    amount: { currency: 'USD', max: 50000 },
    co_finance_required: null,
    reporting: null,
    calls: [
      {
        id: 'round-2026',
        label: '2026 round',
        url: URL,
        status: 'open',
        opens: null,
        deadline: { date: '2026-11-26', text: '26 November 2026' },
        evidence: { status: ev('Applications are now open.'), deadline: ev('Applications close 26 November 2026.') },
      },
    ],
    evidence: { access: ev('Anyone eligible may apply online.'), window: ev('The fund runs one round a year.'), amount: ev('Grants of up to $50,000.') },
    checked_at: '2026-11-01',
  }
}

const problems = (p: unknown) => {
  const r = programme.safeParse(p)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

describe('fixture', () => {
  test('is valid', () => expect(problems(fixture())).toEqual([]))
})

describe('consortium_required', () => {
  test('is optional: a programme without it is valid', () => expect(problems(fixture())).toEqual([]))

  test('needs evidence when stated', () => {
    const p = fixture()
    p.consortium_required = true
    expect(problems(p)).toEqual(['evidence.consortium_required: consortium_required is stated but has no evidence'])
    p.evidence.consortium_required = ev('Applicants must form a consortium of three organisations.')
    expect(problems(p)).toEqual([])
  })

  test('evidence without the field is refused', () => {
    const p = fixture()
    p.evidence.consortium_required = ev('Applicants must form a consortium of three organisations.')
    expect(problems(p)).toEqual(['evidence.consortium_required: consortium_required has evidence but is not stated'])
  })
})

describe('eligibility, documents and step dates', () => {
  test('each eligibility rule has its own quote', () => {
    const p = fixture()
    p.eligibility = [{ rule: 'Operating for at least 3 years', kind: 'track_record' }, { rule: 'Registered in Kenya', kind: 'legal' }]
    p.evidence.eligibility = [ev('Applicants must have operated for at least three years.')]
    expect(problems(p)).toEqual(['evidence.eligibility: each eligibility rule has its own quote: 2 rules, 1 quotes'])
    p.evidence.eligibility.push(ev('Applicants must be registered in Kenya.'))
    expect(problems(p)).toEqual([])
  })

  test('a co-funding share needs co-funding required', () => {
    const p = fixture()
    p.co_finance = { min_share: 50 }
    p.evidence.co_finance = ev('Applicants must match at least 50% of the grant.')
    expect(problems(p)).toEqual(['co_finance: a co-funding share needs co_finance_required: true'])
    p.co_finance_required = true
    p.evidence.co_finance_required = ev('Applicants must match at least 50% of the grant.')
    expect(problems(p)).toEqual([])
  })

  test('after-award duties need at least one duty and evidence', () => {
    const p = fixture()
    p.after_award = {}
    p.evidence.after_award = [ev('Grantees report every quarter.')]
    expect(problems(p)).toEqual(['after_award: after_award needs at least one stated duty'])
    p.after_award = { reports: 'quarterly' }
    expect(problems(p)).toEqual([])
  })

  test('co-funding takes a fractional share, a fixed sum and who it applies to', () => {
    const p = fixture()
    p.co_finance_required = true
    p.evidence.co_finance_required = ev('Non-Indigenous applicants must provide one dollar for every two requested.')
    p.co_finance = { min_share: 33.3, min_amount: { value: 5000, currency: 'CAD' }, applies_to: 'Non-Indigenous applicants' }
    p.evidence.co_finance = ev('Non-Indigenous applicants must provide one dollar for every two requested.')
    expect(problems(p)).toEqual([])
  })

  test('a match is a share or a ratio, never both, and never zero', () => {
    const p = fixture()
    p.co_finance_required = true
    p.evidence.co_finance_required = ev('Applicants provide one dollar for every two requested.')
    p.evidence.co_finance = ev('Applicants provide one dollar for every two requested.')
    p.co_finance = { ratio: '1:2', min_share: 5 }
    expect(problems(p)).toEqual(['co_finance: co_finance takes min_share or ratio, not both'])
    p.co_finance = { ratio: '0:0' }
    expect(problems(p).join(' ')).toContain('co_finance.ratio')
    p.co_finance = { ratio: '1:2' }
    expect(problems(p)).toEqual([])
  })

  test('a misspelled key is refused, not dropped', () => {
    const p = fixture()
    p.after_award = { reports: 'final', audits: true } as never
    p.evidence.after_award = [ev('Grantees submit a final report and an audit.')]
    expect(problems(p).join(' ')).toContain('audits')
  })

  test('documents need evidence', () => {
    const p = fixture()
    p.documents = ['Registration certificate']
    expect(problems(p)).toEqual(['evidence.documents: documents is stated but has no evidence'])
  })

  test('a step date needs its year in an effort quote, one entry per step, in order', () => {
    const p = fixture()
    p.effort = { steps: ['Concept note', 'Full proposal'], due: ['2027-01-08', null] }
    p.evidence.effort = [ev('Concept notes are due by 8 January.')]
    expect(problems(p)).toEqual(['effort.due: no effort quote states 2027-01-08 with its day, month and year together; a yearless date stays null'])
    p.evidence.effort = [ev('The project runs through 2027. Concept notes are due by 8 January.')]
    expect(problems(p)).toEqual(['effort.due: no effort quote states 2027-01-08 with its day, month and year together; a yearless date stays null'])
    p.evidence.effort = [ev('Concept notes are due by 8 January 2027; full proposals by 1 March 2027.')]
    expect(problems(p)).toEqual([])
    p.effort.due = ['2027-03-01', '2027-01-08']
    expect(problems(p)).toEqual(['effort.due: steps are due in order'])
    p.effort.due = ['2027-02-30', null]
    p.evidence.effort = [ev('Concept notes are due by 30 February 2027.')]
    expect(problems(p)).toEqual(['effort.due: 2027-02-30 is not a calendar date'])
    p.evidence.effort = [ev('Concept notes are due by 8 January 2027; full proposals by 1 March 2027.')]
    p.effort.due = ['2027-01-08']
    expect(problems(p)).toEqual(['effort.due: one due entry per step: 2 steps, 1 entries'])
  })
})

describe('typed values on eligibility rules', () => {
  const withRule = (rule: NonNullable<Programme['eligibility']>[number], quote: string) => {
    const p = fixture()
    p.eligibility = [rule]
    p.evidence.eligibility = [ev(quote)]
    return p
  }

  test('years operating, stated as years, words or months', () => {
    const rule = { rule: 'Operating for at least 3 years', kind: 'track_record' as const, min_years: 3 }
    expect(problems(withRule(rule, 'Applicants must have operated for at least 3 years.'))).toEqual([])
    expect(problems(withRule(rule, 'Applicants must have operated for at least three years.'))).toEqual([])
    expect(problems(withRule(rule, 'Organisations must have existed for 36 months.'))).toEqual([])
    expect(problems(withRule(rule, 'Organisations must have existed for some years.'))).toEqual([
      "eligibility.0.min_years: the rule's quote does not state 3 years (or 36 months)",
    ])
  })

  test('a number means what its unit says', () => {
    const three = { rule: 'Operating for at least 3 years', kind: 'track_record' as const, min_years: 3 }
    expect(problems(withRule(three, 'The foundation has supported groups for 36 years.'))).toHaveLength(1)
    expect(problems(withRule({ ...three, min_years: 1 }, '団体として 1 年以上の実活動の実績'))).toEqual([])
    const million = { rule: 'Revenue of at least €1', kind: 'finances' as const, revenue: { currency: 'EUR', min: 1, basis: 'revenue' as const } }
    expect(problems(withRule(million, 'Applicants need an annual revenue of at least EUR 1 million.'))).toHaveLength(1)
    const cap = { rule: 'Request no more than yearly revenue', kind: 'finances' as const, request_cap: { share: 100, of: 'revenue' as const } }
    expect(problems(withRule(cap, 'Tell us your annual revenue in the form.'))).toHaveLength(1)
  })

  test('years operating go on a track-record rule', () => {
    const rule = { rule: 'Operating for at least 2 years', kind: 'legal' as const, min_years: 2 }
    expect(problems(withRule(rule, 'Applicants must be registered for two years.'))).toEqual(['eligibility.0.min_years: years operating go on a track_record rule'])
  })

  test('a revenue range needs its numbers and currency in the quote', () => {
    const rule = {
      rule: 'Average yearly revenue of €60,000 to €500,000', kind: 'finances' as const,
      revenue: { currency: 'EUR', min: 60000, max: 500000, basis: 'revenue' as const, average_years: 3 },
    }
    const quote = 'Over the last three years the applicant must have an average annual revenue of at least EUR 60,000 and no more than EUR 500,000.'
    expect(problems(withRule(rule, quote))).toEqual([])
    expect(problems(withRule(rule, quote.replace('EUR 500,000', '€500.000')))).toEqual([])
    expect(problems(withRule(rule, quote.replace('500,000', '400,000')))).toEqual(["eligibility.0.revenue: the rule's quote does not state 500000"])
    expect(problems(withRule({ ...rule, revenue: { ...rule.revenue, currency: 'USD' } }, quote))).toEqual(["eligibility.0.revenue: the rule's quote does not name USD"])
  })

  test('a budget cap in millions and a scale word', () => {
    const rule = { rule: 'Yearly budget under $2 million', kind: 'finances' as const, revenue: { currency: 'USD', max: 2_000_000, basis: 'budget' as const } }
    expect(problems(withRule(rule, 'Organizations with annual budgets of less than $2 million are eligible.'))).toEqual([])
    expect(problems(withRule(rule, 'Organizations with annual budgets of less than $2M are eligible.'))).toEqual([])
  })

  test('a request capped by revenue', () => {
    const rule = { rule: 'Your request is no more than your yearly revenue', kind: 'finances' as const, request_cap: { share: 100, of: 'revenue' as const } }
    expect(problems(withRule(rule, 'The requested amount must not exceed the average annual revenue of the organisation.'))).toEqual([])
    const half = { ...rule, request_cap: { share: 50, of: 'budget' as const } }
    expect(problems(withRule(half, 'Requests may not exceed 50% of your annual operating budget.'))).toEqual([])
    expect(problems(withRule(half, 'Requests may not exceed your annual operating budget.'))).toEqual(["eligibility.0.request_cap: the rule's quote does not state 50%"])
    expect(problems(withRule(rule, 'Requests may not exceed the grant ceiling of the round.'))).toEqual([
      'eligibility.0.request_cap: the rule’s quote does not compare the request with revenue or a budget',
    ])
  })

  test('a revenue range or request cap goes on a finances rule, and unknown keys are refused', () => {
    const rule = { rule: 'Your request is no more than your yearly revenue', kind: 'capacity' as const, request_cap: { share: 100, of: 'revenue' as const } }
    expect(problems(withRule(rule, 'The request must not exceed the annual revenue.'))).toEqual(['eligibility.0.kind: a revenue range or request cap goes on a finances rule'])
    const typo = { rule: 'Operating for at least 3 years', kind: 'track_record' as const, min_year: 3 } as never
    expect(problems(withRule(typo, 'Applicants must have operated for at least 3 years.')).join(' ')).toContain('min_year')
  })
})

describe('a step date must be stated whole in one quote', () => {
  test.each([
    ['by January 08, 2027.', '2027-01-08', true],
    ['8 de enero de 2027', '2027-01-08', true],
    ['8. Januar 2027', '2027-01-08', true],
    ['8 Jan. 2027', '2027-01-08', true],
    ['08.01.2027', '2027-01-08', true],
    ['due 2027/01/08', '2027-01-08', true],
    ['the 8th of January, 2027', '2027-01-08', true],
    ['The project runs through 2027. Applications are due January 8.', '2027-01-08', false],
    ['Applications close January 8 for projects in 2027.', '2027-01-08', false],
    ['Applications close 8 January 2027.', '2027-02-08', false],
    ['18 January 2027', '2027-01-08', false],
    ['8 Sept. 2027', '2027-09-08', true],
    ['8 January 2027', '2027-13-08', false],
  ])('%p states %s: %p', (quote, date, want) => expect(statesDate(quote, date)).toBe(want))
})

describe('a date quote must state its year', () => {
  test.each([
    ['Applications close 26 November 2026.', true],
    ["Closes 26 Nov '26", true],
    ['Closes 26 Nov ’26', true],
    ["Closes Nov '26", true],
    ["Opens 26 Nov. '26", true],
    ["Closes 26 November '26.", true],
    ["Closes '26 November'", false],
    ["Closes ‘26 November’", false],
    ["The '26 round closes 26 November", false],
    ["Closes Nov '26 November'", false],
    ["Closes Omar '26", false],
    ['Deadline: 26/11/26', true],
    ['Applications close 26 November', false],
    ['Closes on the 26th', false],
    ['Deadline 11/26', false],
    ['Deadline 11/26/2027', false],
    ['Round 26 closes in November', false],
  ])('%p → %p', (quote, ok) => expect(statesYear(quote, '2026-11-26')).toBe(ok))

  test('a yearless deadline quote fails validation', () => {
    const p = fixture()
    p.calls[0].evidence.deadline = ev('Applications close 26 November')
    expect(problems(p)).toEqual([expect.stringContaining('does not state the year')])
  })

  test('the opening date is held to the same rule', () => {
    const p = fixture()
    p.calls[0].opens = '2026-10-01'
    p.calls[0].evidence.opens = ev('Applications open 1 October')
    expect(problems(p)).toEqual([expect.stringContaining('does not state the year')])
  })
})

describe('a quote must say something', () => {
  test.each(['   ', '\n\t  ', '​​​​', 'Grants', 'a b c d e f g'])('%j is refused by the schema', (quote) => {
    const p = fixture()
    p.evidence.amount = ev(quote)
    expect(problems(p)).toEqual([expect.stringContaining('evidence.amount.quote')])
  })

  test('eight characters besides spaces is enough', () => {
    const p = fixture()
    p.evidence.amount = ev('Up to $50k')
    expect(problems(p)).toEqual([])
  })

  test.each(['', '   ', '​'])('%j is never on a page', (quote) => {
    expect(quoteOnPage(comparable('Any page text at all.'), quote)).toBe(false)
  })
})

describe('free text is capped', () => {
  test.each([
    ['name', (p: Programme) => { p.name = 'x'.repeat(201) }],
    ['funder.name', (p: Programme) => { p.funder.name = 'x'.repeat(201) }],
    ['reporting', (p: Programme) => { p.reporting = 'x'.repeat(601); p.evidence.reporting = ev('Grantees submit a final report.') }],
    ['evidence.amount.quote', (p: Programme) => { p.evidence.amount = ev('Grants of up to $50,000. '.repeat(20)) }],
    ['calls.0.label', (p: Programme) => { p.calls[0].label = 'x'.repeat(201) }],
    ['calls', (p: Programme) => { p.calls = Array.from({ length: 21 }, (_, i) => ({ ...p.calls[0], id: `round-${i}` })) }],
    ['url', (p: Programme) => { p.url = `https://funder.example/${'x'.repeat(500)}` }],
    ['id', (p: Programme) => { p.id = 'x'.repeat(81) }],
    ['calls.0.deadline.timezone', (p: Programme) => { p.calls[0].deadline!.timezone = 'x'.repeat(65) }],
    ['geography.countries', (p: Programme) => { p.geography = { scope: 'countries', countries: Array(251).fill('KE') }; p.evidence.geography = ev('Projects in Kenya only.') }],
  ] as const)('%s', (path, change) => {
    const p = fixture()
    change(p)
    expect(problems(p)).toEqual([expect.stringMatching(new RegExp(`^${path.replace('.', '\\.')}: Too (big|long)`))])
  })

  test('a long eligibility list still fits', () => {
    const p = fixture()
    p.evidence.amount = ev('Grants of up to $50,000. '.repeat(15))
    expect(problems(p)).toEqual([])
  })
})

describe('quote matching', () => {
  const page = comparable('Grants of up to $50,000 are available. Applications close 26 November 2026.')

  test('folds case, quote marks, dashes and spaces', () => {
    expect(quoteOnPage(page, 'GRANTS of  up to $50,000\nare available.')).toBe(true)
    expect(quoteOnPage(comparable('The funder’s “main” call – 2026'), "The funder's \"main\" call - 2026")).toBe(true)
  })

  test('a changed quote fails', () => {
    expect(quoteOnPage(page, 'Grants of up to $60,000 are available.')).toBe(false)
    expect(quoteOnPage(page, 'Applications close 27 November 2026.')).toBe(false)
  })

  test('matches page text as the checker extracts it from HTML', async () => {
    const text = comparable(await htmlToText('<html><head><title>x</title></head><body><script>var a = "Grants"</script><p>Grants of up&nbsp;to <b>$50,000</b></p></body></html>'))
    expect(quoteOnPage(text, 'Grants of up to $50,000')).toBe(true)
    expect(quoteOnPage(text, 'var a')).toBe(false)
  })
})

describe('qualifiers', () => {
  const upcoming = (quote: string) => {
    const p = fixture()
    p.calls[0] = { ...p.calls[0], status: 'upcoming', deadline: null, expected: 'June 2027', evidence: { status: ev(quote) } }
    return p
  }

  test('an expected opening names a year its status quote states', () => {
    expect(problems(upcoming('The next round is due to open in June 2027.'))).toEqual([])
    expect(problems(upcoming('The next round opens in June.'))).toEqual([expect.stringContaining('names a year')])
    expect(problems(upcoming("The next round opens in June '27."))).toEqual([])
  })

  test('every year an expected opening names must be in the quote', () => {
    const p = upcoming('The next round opens in December 2026.')
    p.calls[0].expected = 'December 2026 to January 2027'
    expect(problems(p)).toEqual([expect.stringContaining('names a year')])
  })

  test('an expected opening is only for an upcoming call with no firm date', () => {
    const p = upcoming('The next round is due to open in June 2027.')
    p.calls[0].status = 'open'
    expect(problems(p)).toEqual([expect.stringContaining('upcoming call')])
  })

  test('recurring dates and their evidence come together', () => {
    const p = fixture()
    p.calls[0].recurring = '1 March and 1 October'
    expect(problems(p)).toEqual([expect.stringContaining('recurring dates need evidence')])
    p.calls[0].evidence.recurring = ev('Deadlines are March 1 and October 1 each year.')
    expect(problems(p)).toEqual([])
  })

  test('"less than" needs a max', () => {
    const p = fixture()
    p.amount = { currency: 'USD', min: 1000, max_exclusive: true }
    expect(problems(p)).toEqual([expect.stringContaining('max_exclusive needs a max')])
    p.amount = { currency: 'USD', min: 1500, max: 1500, max_exclusive: true }
    expect(problems(p)).toEqual([expect.stringContaining('no room above min')])
  })
})

describe('pool', () => {
  test('is optional and needs evidence when stated', () => {
    const p = fixture()
    p.pool = { currency: 'USD', value: 500000, period: 'round', label: '2026 round' }
    expect(problems(p)).toEqual(['evidence.pool: pool is stated but has no evidence'])
    p.evidence.pool = ev('A total of $500,000 is available in this round.')
    expect(problems(p)).toEqual([])
  })

  test('evidence without a pool is refused', () => {
    const p = fixture()
    p.evidence.pool = ev('A total of $500,000 is available in this round.')
    expect(problems(p)).toEqual(['evidence.pool: pool has evidence but is not stated'])
  })

  test('cannot be smaller than one grant in the same currency', () => {
    const p = fixture()
    p.pool = { currency: 'USD', value: 20000, period: 'round' }
    p.evidence.pool = ev('A total of $20,000 is available in this round.')
    expect(problems(p)).toEqual([expect.stringContaining('smaller than one grant')])
    p.pool.currency = 'EUR'
    expect(problems(p)).toEqual([])
  })

  test('a year or programme pot may be smaller than one multi-year grant', () => {
    const p = fixture()
    p.pool = { currency: 'USD', value: 20000, period: 'year', qualifier: 'planned' }
    p.evidence.pool = ev('About $20,000 is expected to be available each year.')
    expect(problems(p)).toEqual([])
  })

  test('period is round, year or programme', () => {
    const p = fixture()
    p.pool = { currency: 'USD', value: 500000, period: 'decade' as 'round' }
    p.evidence.pool = ev('A total of $500,000 is available in this round.')
    expect(problems(p)).toEqual([expect.stringContaining('pool.period')])
  })
})

describe('an open call cannot be past its deadline', () => {
  const withDeadline = (date: string, time?: string, timezone?: string) => {
    const p = fixture()
    p.calls[0].deadline = { date, ...(time ? { time } : {}), ...(timezone ? { timezone } : {}), text: date }
    p.calls[0].evidence.deadline = ev(`Closes ${date}`)
    return p
  }

  test('a deadline on the check day is still open', () => expect(problems(withDeadline('2026-11-01'))).toEqual([]))

  test('a deadline the day before the check is refused', () => {
    expect(problems(withDeadline('2026-10-31'))).toEqual([expect.stringContaining('open, but the deadline 2026-10-31 passed')])
  })

  test('a deadline still running in the funder’s timezone when the UTC day began is accepted', () => {
    // 31 Oct 17:00 in Los Angeles is 1 Nov 00:00 UTC, the moment the check day starts.
    expect(problems(withDeadline('2026-10-31', '17:00', 'America/Los_Angeles'))).toEqual([])
    expect(problems(withDeadline('2026-10-31', '17:00', 'PDT'))).toEqual([])
  })

  test('a deadline that passed in the funder’s timezone before the UTC day began is refused', () => {
    expect(problems(withDeadline('2026-10-31', '17:00', 'Europe/Madrid'))).toHaveLength(1)
  })

  test('an unreadable timezone gives the call the benefit of the doubt', () => {
    expect(problems(withDeadline('2026-10-31', '17:00', 'Funder time'))).toEqual([])
  })

  test('a closed call may have any past deadline', () => {
    const p = withDeadline('2020-01-01')
    p.calls[0].status = 'closed'
    expect(problems(p)).toEqual([])
  })
})

describe('the seeded data', () => {
  test('every programme and source is valid', () => {
    const { programmes, issues } = checkData()
    expect(issues).toEqual([])
    expect(programmes.length).toBeGreaterThanOrEqual(40)
  })
})

describe('poolText', () => {
  test('names the period once and keeps a symbol-less currency single', async () => {
    const { poolText } = await import('../../src/lib/format')
    expect(poolText({ currency: 'EUR', value: 17000000, period: 'round', qualifier: 'up_to', label: 'the 2026 call' })).toBe('up to €17,000,000 EUR for the 2026 call')
    expect(poolText({ currency: 'BTN', value: 6000000, period: 'year' })?.replace(/\u00a0/g, ' ')).toBe('BTN 6,000,000 a year')
    expect(poolText({ currency: 'EUR', value: 60000000, period: 'round', qualifier: 'planned' })).toBe('€60,000,000 EUR for the round (planned, not final)')
  })
})
