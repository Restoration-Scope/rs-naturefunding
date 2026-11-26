import { describe, expect, test } from 'bun:test'
import { cardsOf, DIRECTORIES, directoryLeads } from './discover-directories'
import { isNotFunder } from './discover-web'

const charter = DIRECTORIES[0]
const card = (title: string, href: string, text = '') =>
  `<div class="funding-item h-100"><h3>${title}</h3><div class="funding-description"><p>${text}</p></div><div class="funding-deadlines">27/11/2026</div><a href="${href}" class="funding-link"> Learn more </a></div>`

describe('cardsOf', () => {
  test('reads each card’s title and its own link, not links in its text', () => {
    const html = card('Cash  Grants &amp; more', 'https://funder.org/a?x=1&amp;y=2', 'See <a href="https://portal.org/login">the portal</a>') + card('No link', '')
    expect(cardsOf(html, charter)[0]).toEqual({ title: 'Cash Grants & more', url: 'https://funder.org/a?x=1&y=2' })
  })
  test('a changed layout gives no cards', () => {
    expect(cardsOf('<div class="call"><h3>X</h3></div>', charter)).toEqual([])
  })
})

describe('directoryLeads', () => {
  const lead = (url: string) => ({ title: 'Call', url, directory: charter.name })
  const known = { 'web:raised.org': { title: 'R', url: 'https://raised.org/other', deadline: null, first_seen: '2026-11-03', issue: null } }

  test('a new page on a known site is raised and marked; a cited or raised page is not', () => {
    const leads = directoryLeads(
      [lead('https://raised.org/award'), lead('https://raised.org/other/'), lead('https://listed.org/grants/'), lead('https://new.org/call'), lead('https://www.new.org/call#apply')],
      known,
      ['https://www.listed.org/grants'],
    )
    expect(leads.map((l) => [l.key, l.knownSite])).toEqual([['dir:raised.org/award', true], ['dir:new.org/call', false]])
  })
  test('other directories, the EU portal and non-web links are skipped', () => {
    expect(directoryLeads([lead('https://opportunitytracker.ug/x'), lead('https://ec.europa.eu/info/funding-tenders/x'), lead('mailto:a@b.org')], {}, [])).toEqual([])
  })
})

test('every watched directory is listed as not a funder', () => {
  for (const d of DIRECTORIES) expect(isNotFunder(new URL(d.url).host)).toBe(true)
})
