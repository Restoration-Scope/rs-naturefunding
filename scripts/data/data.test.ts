import { describe, expect, test } from 'bun:test'
import { programme, statesYear, type Programme } from '../../src/data/schema'
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

describe('a date quote must state its year', () => {
  test.each([
    ['Applications close 26 November 2026.', true],
    ["Closes 26 Nov '26", true],
    ['Closes 26 Nov ’26', true],
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
