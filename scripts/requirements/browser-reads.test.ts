import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserQueue, isChallenge, saveBrowserRead, withBrowserReads } from './browser-reads'
import type { Reader } from './gather'

const enc = (s: string) => new TextEncoder().encode(s)
const refused = (kind: 'blocked' | 'robots' | 'http'): Reader => async () => ({ ok: false, kind, message: kind })

describe('browser reads', () => {
  test('a page the fetcher was refused reads from its browser copy; other failures pass through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-'))
    saveBrowserRead(dir, 'https://funder.example.org/call', enc('<html><body>Who can apply</body></html>'))
    const read = await withBrowserReads(refused('blocked'), dir)('https://funder.example.org/call')
    expect(read).toMatchObject({ ok: true, pdf: false, finalUrl: 'https://funder.example.org/call' })
    expect(read.ok && read.html).toContain('Who can apply')
    expect((await withBrowserReads(refused('robots'), dir)('https://funder.example.org/other')).ok).toBe(false)
    expect((await withBrowserReads(refused('http'), dir)('https://funder.example.org/call')).ok).toBe(false)
  })

  test('a stored PDF stays a PDF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-'))
    saveBrowserRead(dir, 'https://funder.example.org/guide.pdf', enc('%PDF-1.7 body'))
    const read = await withBrowserReads(refused('robots'), dir)('https://funder.example.org/guide.pdf')
    expect(read).toMatchObject({ ok: true, pdf: true, html: '' })
  })

  test('the queue holds blocked and robots URLs not yet read or skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-'))
    const run = mkdtempSync(join(tmpdir(), 'run-'))
    mkdirSync(join(run, 'docs', 'p'), { recursive: true })
    const failures = [
      { url: 'https://a.example.org/blocked', kind: 'blocked' },
      { url: 'https://a.example.org/robots', kind: 'robots' },
      { url: 'https://a.example.org/dead', kind: 'dead' },
      { url: 'https://a.example.org/read', kind: 'blocked' },
      { url: 'https://a.example.org/skipped', kind: 'blocked' },
    ]
    writeFileSync(join(run, 'docs', 'p', 'gathered.json'), JSON.stringify({ failures }))
    saveBrowserRead(dir, 'https://a.example.org/read', enc('<html></html>'))
    appendFileSync(join(dir, 'skipped.txt'), 'https://a.example.org/skipped\n')
    expect(browserQueue(run, dir)).toEqual(['https://a.example.org/blocked', 'https://a.example.org/robots'])
    // A full run keeps only the reading, with the same failures.
    const reading = join(run, 'p.json')
    writeFileSync(reading, JSON.stringify({ id: 'p', failures }))
    expect(browserQueue(reading, dir)).toEqual(['https://a.example.org/blocked', 'https://a.example.org/robots'])
  })

  test('a challenge page is refused; a real page that carries the filter script is kept', () => {
    expect(isChallenge(enc('<html><head><title>Just a moment...</title></head><body></body></html>'))).toBe(true)
    expect(isChallenge(enc('<html><body><script src="/_Incapsula_Resource?x=1"></script>Request unsuccessful.</body></html>'))).toBe(true)
    const real = `<html><body><script src="/_Incapsula_Resource?x=1"></script><main>${'Eligible applicants are registered charities. '.repeat(60)}</main></body></html>`
    expect(isChallenge(enc(real))).toBe(false)
    expect(isChallenge(enc('%PDF-1.7 Just a moment'))).toBe(false)
  })
})
