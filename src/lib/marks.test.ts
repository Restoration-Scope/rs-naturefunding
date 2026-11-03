import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { programmes } from './data'
import { domainOf, markFor, marks, monogram, type MarkEntry } from './marks'

const entry = (domain: string, fields: Partial<MarkEntry>): MarkEntry => ({
  domain, orgs: [], homepage: `https://${domain}/`, source: null, source_px: null, fetched_at: '2026-11-01T00:00:00.000Z',
  file: null, bytes: null, fallback: null, ...fields,
})

describe('domainOf', () => {
  test('lowercases the host and drops a leading www.', () => {
    expect(domainOf('https://WWW.Rufford.org/grants/')).toBe('rufford.org')
    expect(domainOf('https://ghana.arocha.org/x')).toBe('ghana.arocha.org')
  })
  test('null for a URL it cannot parse', () => {
    expect(domainOf('not a url')).toBeNull()
  })
})

describe('monogram', () => {
  test("an acronym's first two letters", () => {
    expect(monogram('UNDP Peru')).toBe('UN')
    expect(monogram('IUCN')).toBe('IU')
  })
  test('the first letters of the first two words that count, skipping brackets and small words', () => {
    expect(monogram('The Rufford Foundation')).toBe('RF')
    expect(monogram('Rapid Response Facility (Fauna & Flora and UNESCO)')).toBe('RR')
    expect(monogram('Fondo Mexicano para la Conservación de la Naturaleza (FMCN)')).toBe('FM')
  })
  test('one letter for a one-word name; a mark even for an empty one', () => {
    expect(monogram('Seacology')).toBe('S')
    expect(monogram('  ')).toBe('?')
  })
})

describe('markFor', () => {
  const entries = {
    'rufford.org': entry('rufford.org', { source: 'https://www.rufford.org/favicon.ico', file: 'marks/rufford.org.webp', bytes: 500 }),
    'cepf.net': entry('cepf.net', { fallback: 'homepage: blocked (HTTP 403)' }),
  }
  test('an organisation whose domain has a stored icon gets it, whatever the path', () => {
    expect(markFor({ name: 'The Rufford Foundation', url: 'https://www.rufford.org/some/page' }, entries)).toEqual({
      kind: 'icon', domain: 'rufford.org', src: '/marks/rufford.org.webp', letters: 'RF',
    })
  })
  test('a recorded fallback gives the monogram with its reason', () => {
    expect(markFor({ name: 'Critical Ecosystem Partnership Fund', url: 'https://www.cepf.net/' }, entries)).toEqual({
      kind: 'monogram', domain: 'cepf.net', letters: 'CE', reason: 'homepage: blocked (HTTP 403)',
    })
  })
  test('an unknown domain or a bad URL gives the monogram', () => {
    expect(markFor({ name: 'New Fund', url: 'https://new.example/' }, entries).kind).toBe('monogram')
    expect(markFor({ name: 'New Fund', url: 'nope' }, entries)).toMatchObject({ kind: 'monogram', domain: null, letters: 'NF' })
  })
})

describe('data/marks.json', () => {
  const orgs = programmes.flatMap((p) => [p.funder, p.administered_by]).filter((o) => o !== null)

  test('every funder and administrator has an entry for its domain', () => {
    for (const o of orgs) expect(marks[domainOf(o.url)!], `${o.name} (${o.url}): run bun run sync-favicons`).toBeDefined()
  })

  test('each entry has a self-hosted file or a fallback reason, never both', () => {
    for (const e of Object.values(marks)) {
      expect(!!e.file !== !!e.fallback, e.domain).toBe(true)
      if (e.fallback) expect(e.fallback.length, e.domain).toBeGreaterThan(5)
    }
  })

  test('each file is a small 64×64 WebP in public/', () => {
    for (const e of Object.values(marks).filter((x) => x.file)) {
      const path = join(import.meta.dir, '..', '..', 'public', e.file!)
      expect(existsSync(path), e.file!).toBe(true)
      expect(e.file!).toMatch(/^marks\/[a-z0-9.-]+\.webp$/)
      expect(statSync(path).size, e.file!).toBe(e.bytes!)
      expect(e.bytes!, e.file!).toBeLessThanOrEqual(8 * 1024)
      const b = readFileSync(path)
      expect(b.subarray(0, 4).toString() + b.subarray(8, 12).toString(), e.file!).toBe('RIFFWEBP')
    }
  })
})
