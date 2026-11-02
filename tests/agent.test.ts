// Guards on what an AI agent reads: llms.txt, the Markdown twin of every page, fact anchors, JSON-LD and the
// JSON Schema. Builds into dist/ first unless DIST_TEST_REUSE=1, like dist.test.ts.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import { evidenceOf } from '../src/data/load'
import { listingFor, programmes } from '../src/lib/data'
import { longDate } from '../src/lib/format'
import { absolute } from '../src/lib/site'
import { twinPath } from '../src/lib/twins'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')

if (process.env.DIST_TEST_REUSE !== '1' || !existsSync(join(dist, 'index.html'))) {
  const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (build.exitCode !== 0) throw new Error(`build failed:\n${build.stderr.toString()}\n${build.stdout.toString()}`)
}

const read = (f: string) => readFileSync(join(dist, f), 'utf8')
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const site = absolute('/')
const local = (url: string) => url.slice(site.length - 1)
const htmlFile = (path: string) => `${path.slice(1)}index.html`
const sitemap = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => local(m[1]!))
const llms = read('llms.txt')

describe('every page has a Markdown twin', () => {
  test('each sitemap page links its twin, the twin is built, and llms.txt lists it', () => {
    expect(sitemap.length).toBeGreaterThan(3)
    for (const path of sitemap) {
      const twin = absolute(twinPath(path))
      const link = parseHTML(read(htmlFile(path))).document.querySelector('link[rel="alternate"][type="text/markdown"]')
      expect(link?.getAttribute('href'), path).toBe(twin)
      expect(existsSync(join(dist, twinPath(path).slice(1))), twin).toBe(true)
      expect(llms.includes(`](${twin})`), `llms.txt lists ${twin}`).toBe(true)
    }
  })

  test('llms-full.txt has the prose pages in place of its marker', () => {
    const full = read('llms-full.txt')
    expect(full).not.toContain('<!-- pages -->')
    expect(full).toContain('## How we check')
    expect(full).toContain('## The open data')
  })
})

describe('programme twins keep the evidence', () => {
  test('each twin has every quote with its checked date, and each fact it cites is an anchor on the page', () => {
    for (const p of programmes) {
      const md = norm(read(`p/${p.id}.md`))
      for (const e of evidenceOf(p)) {
        expect(md.includes(norm(e.quote)), `${p.id}: quote “${e.quote.slice(0, 40)}”`).toBe(true)
        expect(md.includes(`checked ${longDate(e.checked_at)}`), `${p.id}: ${e.checked_at}`).toBe(true)
      }
      const page = parseHTML(read(`p/${p.id}/index.html`)).document
      for (const [, id] of md.matchAll(new RegExp(`${absolute(`/p/${p.id}/`)}#([\\w-]+)`, 'g'))) {
        expect(page.getElementById(id!), `${p.id}#${id}`).not.toBeNull()
      }
    }
  })

  test('no page hides text that a text reader would still pick up', () => {
    for (const p of programmes) {
      const page = parseHTML(read(`p/${p.id}/index.html`)).document
      for (const el of page.querySelectorAll('main [hidden]')) expect(norm(el.textContent ?? ''), `${p.id}`).toBe('')
    }
  })
})

describe('programme JSON-LD', () => {
  test('a WebPage with its checked date and every funder page it rests on; grants carry the MonetaryGrant', () => {
    for (const p of programmes) {
      const page = parseHTML(read(`p/${p.id}/index.html`)).document
      const ld = [...page.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? ''))
      const web = ld.find((o) => o['@type'] === 'WebPage')
      expect(web?.lastReviewed, p.id).toBe(p.checked_at)
      expect([...web.isBasedOn].sort(), p.id).toEqual([...new Set(evidenceOf(p).map((e) => e.source_url))].sort())
      expect(web.mainEntity?.['@type'], p.id).toBe(p.kind === 'partnership' ? undefined : 'MonetaryGrant')
      const { state, call } = listingFor(p)
      if (web.mainEntity && p.access === 'direct' && state === 'open' && call?.deadline) {
        expect(web.mainEntity.potentialAction?.endTime, p.id).toBe(call.deadline.date)
      }
    }
  })
})

describe('data.json is documented', () => {
  test('it links its JSON Schema, and every object property in the schema has a description', () => {
    expect(JSON.parse(read('data.json')).$schema).toBe(absolute('/data.schema.json'))
    const missing: string[] = []
    const walk = (node: unknown, at: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}[${i}]`))
      if (!node || typeof node !== 'object') return
      const o = node as Record<string, unknown>
      for (const [k, v] of Object.entries((o.properties ?? {}) as Record<string, { description?: string }>)) {
        if (!v.description) missing.push(`${at}.${k}`)
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`)
    }
    walk(JSON.parse(read('data.schema.json')), '$')
    expect(missing).toEqual([])
  })
})
