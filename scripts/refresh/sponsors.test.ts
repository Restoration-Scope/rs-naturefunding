import { describe, expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Sponsor } from '../../src/data/sponsors'
import { hashText, type Fetched } from './fetch'
import { rawSponsors, sponsorCounts, sponsorIssues, sponsorPass, sponsorSection, SPONSORS_DIR, writeSponsor } from './sponsors'
import { issueBody, MAX_ISSUE_BODY } from './weekly-body'

const NOW = new Date('2026-11-30T06:43:00Z')
const TODAY = '2026-11-30'
const A = 'https://sponsor.example/about'
const B = 'https://sponsor.example/fees'
const PAGE_A = 'Example Sponsor is registered in England. We sponsor wildlife projects.'
const PAGE_B = 'A fee of 5% is charged. Staff can be paid.'

const fact = <T>(value: T, source_url: string, quote: string, checked_at = '2026-11-24', method: 'page' | 'human' = 'page') => ({
  value,
  evidence: { source_url, quote, checked_at, method },
})
const fixture = (over: Partial<Sponsor> = {}): Sponsor => ({
  id: 'example-sponsor',
  name: 'Example Sponsor',
  url: A,
  summary: 'Charity that takes wildlife projects.',
  country: fact('GB', A, 'registered in England'),
  projects: fact('Wildlife projects', A, 'We sponsor wildlife projects.'),
  types: [fact('wildlife', A, 'We sponsor wildlife projects.')],
  fees: [fact('5% of income', B, 'A fee of 5% is charged.')],
  staff: fact({ answer: 'yes' }, B, 'Staff can be paid.'),
  checked_at: '2026-11-24',
  ...over,
})
const ok = (url: string, text: string, finalUrl = url): Fetched => ({ ok: true, url, finalUrl, status: 200, pdf: false, text, hash: hashText(text) })
const blocked = (url: string): Fetched => ({ ok: false, url, kind: 'blocked', message: 'HTTP 403' })
const reads = (...pages: Fetched[]) => new Map(pages.map((p) => [p.url, p]))
const pass = (sponsors: Sponsor[], ...pages: Fetched[]) => sponsorPass(sponsors, reads(...pages), NOW)
/** The sponsor with every date removed: what a re-read may never change. */
const undated = (s: object) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'checked_at' ? undefined : v)))

describe('fiscal sponsors re-read', () => {
  test('same: every fact and the sponsor get today’s date, and nothing else moves', () => {
    const before = fixture()
    const r = pass([before], ok(A, PAGE_A), ok(B, PAGE_B))
    expect(r.pages.map((p) => p.result)).toEqual(['same', 'same'])
    const [after] = r.updated
    expect([after.country, after.projects, after.types[0], after.fees![0], after.staff!].map((f) => f.evidence.checked_at)).toEqual(Array(5).fill(TODAY))
    expect(after.checked_at).toBe(TODAY)
    expect(undated(after)).toEqual(undated(before))
    expect(before).toEqual(fixture())
    expect(r.dated).toBe(5)
    expect(sponsorIssues(r)).toEqual([])
  })

  test('new text around the quotes changes nothing', () => {
    expect(pass([fixture()], ok(A, `${PAGE_A} News: a new director.`), ok(B, PAGE_B)).dated).toBe(5)
  })

  test('quote gone: no fact of that page is dated, the sponsor keeps its date, and an issue is drafted', () => {
    const r = pass([fixture()], ok(A, PAGE_A), ok(B, 'A fee of 8% is charged. Staff can be paid.'))
    const [after] = r.updated
    expect(after.fees![0]).toEqual(fixture().fees![0])
    expect(after.staff).toEqual(fixture().staff)
    expect(after.country.evidence.checked_at).toBe(TODAY)
    expect(after.checked_at).toBe('2026-11-24')
    expect(r.dated).toBe(3)
    const [issue, ...more] = sponsorIssues(r)
    expect(more).toEqual([])
    expect(issue.files).toEqual({})
    expect(issue.title).toBe('Refresh: fiscal sponsor page sponsor.example/fees')
    expect(issue.body).toContain('quote gone (example-sponsor fees[0]): "A fee of 5% is charged."')
    expect(issue.body).toContain('`data/sponsors/example-sponsor.json`')
    expect(sponsorSection(r, [fixture()], '2026-10-31').join('\n')).toContain(`- changed ${B} (example-sponsor): quote gone`)
  })

  test('a quote gone for one sponsor holds the page’s facts for every sponsor citing it', () => {
    const other = fixture({ id: 'other-sponsor', fees: [fact('6% of income', B, 'A fee of 6% is charged.')] })
    const r = pass([fixture(), other], ok(A, PAGE_A), ok(B, PAGE_B))
    expect(r.updated.map((s) => s.fees![0].evidence.checked_at)).toEqual(['2026-11-24', '2026-11-24'])
    expect(sponsorIssues(r)).toHaveLength(1)
  })

  test('blocked: the page’s facts keep their dates and it is reported, with no issue', () => {
    const r = pass([fixture()], ok(A, PAGE_A), blocked(B))
    expect(r.updated[0].fees![0].evidence.checked_at).toBe('2026-11-24')
    expect(r.updated[0].checked_at).toBe('2026-11-24')
    expect(sponsorIssues(r)).toEqual([])
    expect(sponsorSection(r, [fixture()], '2026-10-31')).toContain(`- not read ${B} (example-sponsor): blocked, HTTP 403`)
    expect(sponsorCounts(r, 1)).toBe('2 pages of 1 sponsors: 1 with every quote still there, 0 changed, 1 not read. 3 facts dated today in 1 sponsors.')
  })

  test('nothing readable: nothing is written', () => {
    expect(pass([fixture()], blocked(A), blocked(B)).updated).toEqual([])
  })

  test('moved to another site with the quotes there: dated and listed; without them: changed', () => {
    const r = pass([fixture()], ok(A, PAGE_A), ok(B, PAGE_B, 'https://elsewhere.example/fees'))
    expect(r.updated[0].checked_at).toBe(TODAY)
    expect(sponsorIssues(r)).toEqual([])
    expect(sponsorSection(r, [fixture()], '2026-10-31')).toContain(`- moved, every quote still there: ${B} (example-sponsor) → https://elsewhere.example/fees`)
    expect(sponsorIssues(pass([fixture()], ok(A, PAGE_A), ok(B, 'Buy our shoes.', 'https://elsewhere.example/')))).toHaveLength(1)
  })

  test('a fact a person read keeps its date and holds the sponsor’s', () => {
    const r = pass([fixture({ staff: fact({ answer: 'yes' }, B, 'Told by phone.', '2026-11-20', 'human'), checked_at: '2026-11-20' })], ok(A, PAGE_A), ok(B, PAGE_B))
    expect(r.updated[0].staff!.evidence.checked_at).toBe('2026-11-20')
    expect(r.updated[0].checked_at).toBe('2026-11-20')
    expect([r.dated, r.human]).toEqual([4, 1])
  })

  test('a date never moves back, and a second run the same day writes nothing', () => {
    const r = pass([fixture()], ok(A, PAGE_A), ok(B, PAGE_B))
    expect(pass(r.updated, ok(A, PAGE_A), ok(B, PAGE_B)).updated).toEqual([])
    expect(sponsorPass(r.updated, reads(ok(A, PAGE_A), ok(B, PAGE_B)), new Date('2026-11-25T00:00:00Z')).updated).toEqual([])
  })

  test('a dated file that fails the schema is reported, not written', () => {
    const r = pass([fixture({ summary: 'short' })], ok(A, PAGE_A), ok(B, PAGE_B))
    expect(r.updated).toEqual([])
    expect(r.invalid[0]).toStartWith('`example-sponsor`: summary')
    expect(sponsorSection(r, [fixture()], '2026-10-31').join('\n')).toContain('- not written')
  })

  test('a sponsor held over 30 days is listed', () => {
    expect(sponsorSection(pass([fixture()], blocked(A), blocked(B)), [fixture()], '2026-11-25')).toContain('- stale over 30 days: `example-sponsor` last fully re-read 2026-11-24')
  })

  test('each listed sponsor is written in its own layout, changing only dates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sponsors-'))
    const files = readdirSync(SPONSORS_DIR).filter((f) => f.endsWith('.json'))
    for (const f of files) copyFileSync(join(SPONSORS_DIR, f), join(dir, f))
    for (const s of rawSponsors(files.map((f) => basename(f, '.json')), dir)) {
      const file = join(dir, `${s.id}.json`)
      const was = readFileSync(file, 'utf8')
      writeSponsor(s, dir)
      expect(readFileSync(file, 'utf8')).toBe(was)
      for (const line of [s, ...[s.country, s.projects].map((f) => f.evidence)]) line.checked_at = '2027-01-01'
      writeSponsor(s, dir)
      const diff = readFileSync(file, 'utf8').split('\n').filter((l, i) => l !== was.split('\n')[i])
      expect(diff.every((l) => l.includes('2027-01-01'))).toBe(true)
    }
    writeFileSync(join(dir, 'example-sponsor.json'), 'not json')
    expect(() => writeSponsor(fixture(), dir)).toThrow()
  })
})

describe('the weekly summary as an issue', () => {
  test('a short one is whole', () => expect(issueBody('a\nb', 'https://run.example')).toBe('a\nb'))

  test('a long one is cut at a line end, under the limit, and names the run', () => {
    const body = Array.from({ length: 5000 }, (_, i) => `- line ${i} with some words on it`).join('\n')
    const cut = issueBody(body, 'https://run.example')
    expect(cut.length).toBeLessThanOrEqual(MAX_ISSUE_BODY)
    expect(cut).toEndWith('https://run.example')
    expect(body.startsWith(`${cut.slice(0, cut.indexOf('\n\nCut to fit'))}\n`)).toBe(true)
  })
})
