// Guards on the built site: the pages, the finder's DOM contract, the evidence on each programme page,
// and how much JavaScript ships. It builds into dist/ first (about 2 s); set DIST_TEST_REUSE=1 to test
// the dist/ already there.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parseHTML } from 'linkedom'
import { evidenceOf } from '../src/data/load'
import { COUNTRY_PAGES, countrySlug } from '../src/lib/countries'
import { listings, programmes } from '../src/lib/data'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')

if (process.env.DIST_TEST_REUSE !== '1' || !existsSync(join(dist, 'index.html'))) {
  const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (build.exitCode !== 0) throw new Error(`build failed:\n${build.stderr.toString()}\n${build.stdout.toString()}`)
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
const files = walk(dist).map((f) => relative(dist, f))
const htmlFiles = files.filter((f) => f.endsWith('.html')).sort()
const read = (f: string) => readFileSync(join(dist, f), 'utf8')
const doc = (f: string) => parseHTML(read(f)).document
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Pages that are not programme pages, as built before the shadcn port. */
const staticPages: string[] = JSON.parse(readFileSync(join(import.meta.dir, 'static-pages.json'), 'utf8'))

describe('pages', () => {
  test('the same static pages, plus one page per programme and per country', () => {
    const expected = [
      ...staticPages,
      ...programmes.map((p) => `p/${p.id}/index.html`),
      ...COUNTRY_PAGES.map((c) => `countries/${countrySlug(c)}/index.html`),
    ].sort()
    expect(htmlFiles).toEqual(expected)
  })
})

describe('finder DOM contract (src/lib/finder.ts)', () => {
  const d = doc('index.html')
  const finderSource = readFileSync(join(root, 'src/lib/finder.ts'), 'utf8')
  const rows = [...d.querySelectorAll('[data-list] > tr, [data-list-later] > tr')] as HTMLElement[]

  test('one row per listing, each with the attributes finder.ts reads', () => {
    expect(rows.length).toBe(listings.length)
    const required = ['state', 'checked', 'name', 'approach', 'applicant', 'access', 'where', 'size', 'text']
    for (const r of rows) {
      for (const a of required) expect(r.hasAttribute(`data-${a}`), `${r.dataset.name} lacks data-${a}`).toBe(true)
      expect(r.querySelector('.dl'), `${r.dataset.name} lacks .dl`).not.toBeNull()
      expect(r.querySelectorAll('.stamp').length, `${r.dataset.name} lacks .stamp`).toBeGreaterThan(0)
    }
    // Rows carry the same values the data gives.
    const byName = new Map(listings.map((l) => [l.p.name.toLowerCase(), l]))
    for (const r of rows) {
      const l = byName.get(r.dataset.name!)
      expect(l, r.dataset.name).toBeDefined()
      expect(r.dataset.state).toBe(l!.state)
      expect(r.dataset.checked).toBe(l!.p.checked_at)
      expect(r.dataset.access).toBe(l!.p.access)
      expect(r.dataset.deadline ?? null).toBe(l!.call?.deadline?.date ?? null)
      if (l!.state === 'open' && l!.call?.deadline) expect(r.querySelector('[data-left]'), r.dataset.name).not.toBeNull()
    }
  })

  test('a stated deadline keeps the funder’s words in the date’s tooltip, in every state', () => {
    const byName = new Map(listings.map((l) => [l.p.name.toLowerCase(), l]))
    for (const r of rows) {
      const deadline = byName.get(r.dataset.name!)!.call?.deadline
      if (!deadline) continue
      const when = r.querySelector('.dl__when')
      expect(when?.getAttribute('title') ?? '', r.dataset.name).toContain(deadline.text)
      expect(norm(when?.textContent ?? ''), r.dataset.name).not.toBe('Not dated yet')
    }
  })

  test('one status vocabulary in the status column; the route always under the funder', () => {
    const states: Record<string, string> = { open: 'Open', rolling: 'Rolling', upcoming: 'Upcoming', closed: 'Closed', none: 'No call found' }
    for (const r of rows) {
      const status = r.querySelector('.dl__meta > .status')
      expect(status?.getAttribute('data-state'), r.dataset.name).toBe(r.dataset.state!)
      expect(norm(status?.textContent ?? ''), r.dataset.name).toBe(states[r.dataset.state!]!)
      expect(r.querySelector('.sub__route [data-route]')?.getAttribute('data-route'), r.dataset.name).toBe(r.dataset.access!)
    }
    for (const q of d.querySelectorAll('[data-quick], [data-later-toggle]')) expect(q.getAttribute('aria-pressed'), q.textContent!).toBe('false')
  })

  test('every literal selector finder.ts queries is in the page', () => {
    // Literal selectors passed to $(), querySelector(All)() and closest(); templated ones are checked below.
    const literal = [...finderSource.matchAll(/(?:\$<[^>]+>|querySelector(?:All)?(?:<[^>]+>)?|closest(?:<[^>]+>)?)\(\s*'([^']+)'/g)].map((m) => m[1]!)
    // Made by finder.ts itself at runtime, so not in the built HTML.
    const runtime = new Set(['[data-later-show]', 'b'])
    const selectors = [...new Set(literal)].filter((s) => !runtime.has(s))
    expect(selectors.length).toBeGreaterThan(30)
    for (const s of selectors) {
      for (const part of s.split(',').map((x) => x.trim()).filter((x) => x !== '[tabindex]')) {
        expect(d.querySelector(part), `missing ${part}`).not.toBeNull()
      }
    }
  })

  test('the structure finder.ts relies on', () => {
    const form = d.querySelector('[data-form]')!
    const sheet = d.querySelector('[data-sheet]')!
    expect(form.querySelector('[name="q"]')).not.toBeNull()
    expect(form.contains(sheet)).toBe(true)
    expect(sheet.querySelector('[data-sheet-close]')).not.toBeNull()
    expect(sheet.querySelector('[data-sheet-done]')).not.toBeNull()
    expect([...d.querySelectorAll('th[data-col]')].map((th) => th.getAttribute('data-col'))).toEqual(['deadline', 'amount'])
    expect(d.querySelectorAll('[data-sort]').length).toBe(3)
    for (const k of ['open', 'rolling', 'upcoming', 'later']) {
      const qn = d.querySelector(`[data-qn="${k}"]`)
      expect(qn, `data-qn=${k}`).not.toBeNull()
      if (k !== 'later') expect(qn!.closest('[data-quick]'), `data-qn=${k} in a quick filter`).not.toBeNull()
    }
    expect(d.querySelector('[data-ql="open"]')).not.toBeNull()
    for (const q of d.querySelectorAll('[data-quick]')) expect(q.querySelector('b'), q.getAttribute('data-quick')!).not.toBeNull()
    // Each count sits in a label with its input and its text.
    for (const n of d.querySelectorAll('[data-n]')) {
      const label = n.closest('label')
      expect(label, n.getAttribute('data-n')!).not.toBeNull()
      expect(label!.querySelector('input')).not.toBeNull()
      expect(label!.querySelector('.opt__text')).not.toBeNull()
    }
    for (const input of form.querySelectorAll('input[type="checkbox"]')) {
      expect(input.closest('label')?.querySelector('.opt__text'), `${input.getAttribute('name')}=${input.getAttribute('value')}`).not.toBeNull()
    }
    // Every group is always open: no folding toggles.
    expect(form.querySelectorAll('details, summary').length).toBe(0)
    const groups = [...form.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'))
    // The sidebar holds only what the header card doesn't.
    expect(groups.sort()).toEqual(['access', 'size', 'status'])
    for (const g of form.querySelectorAll('[data-gcount]')) expect(groups).toContain(g.getAttribute('data-gcount'))
  })

  test('the classes finder.ts creates are styled', () => {
    const css = files.filter((f) => f.endsWith('.css')).map(read).join('\n') + read('index.html')
    for (const c of ['status', 'dl__when', 'dl__when--muted', 'dl__meta', 'linkish']) {
      expect(css.includes(`.${c}`), `.${c} has no CSS`).toBe(true)
    }
  })
})

describe('no hydration, small JavaScript', () => {
  const scriptsOf = (f: string) => {
    const d = doc(f)
    const all = [...d.querySelectorAll('script')].filter((s) => s.getAttribute('type') !== 'application/ld+json')
    return {
      external: all.filter((s) => s.hasAttribute('src')).map((s) => s.getAttribute('src')!),
      inline: all.filter((s) => !s.hasAttribute('src')).map((s) => s.textContent ?? ''),
    }
  }

  test('no astro-island or React slot anywhere', () => {
    for (const f of files.filter((x) => /\.(html|js)$/.test(x))) {
      const text = read(f)
      for (const marker of ['astro-island', 'astro-slot', 'astro-static-slot', 'client:']) {
        expect(text.includes(marker), `${f} contains ${marker}`).toBe(false)
      }
    }
  })

  test('/ ships at most 12 KB of gzipped JavaScript', () => {
    const { external, inline } = scriptsOf('index.html')
    const js = [...external.map((src) => read(src.replace(/^\//, ''))), ...inline]
    const gz = js.reduce((n, s) => n + gzipSync(s).length, 0)
    expect(gz).toBeGreaterThan(0)
    expect(gz).toBeLessThanOrEqual(12 * 1024)
  })

  test('no other page loads a script file; only /about/ has its small inline contents toggle', () => {
    for (const f of htmlFiles.filter((x) => x !== 'index.html')) {
      const { external, inline } = scriptsOf(f)
      expect(external, f).toEqual([])
      if (f === 'about/index.html') {
        expect(inline.length).toBeLessThanOrEqual(1)
        expect(inline.join('').length).toBeLessThanOrEqual(400)
      } else expect(inline, f).toEqual([])
    }
  })

  test('every JS file in dist is the one / loads', () => {
    const loaded = new Set(scriptsOf('index.html').external.map((s) => s.replace(/^\//, '')))
    expect(files.filter((f) => f.endsWith('.js')).sort()).toEqual([...loaded].sort())
  })
})

describe('self-hosted fonts', () => {
  const css = files.filter((f) => f.endsWith('.css')).map(read).join('\n')
  const fontFiles = files.filter((f) => f.endsWith('.woff2')).sort()
  const thirdPartyFonts = /fonts\.(googleapis|gstatic)\.com|fontshare\.com|use\.typekit\.net/

  test('every @font-face url is a woff2 in /fonts/ that dist holds, shown with font-display: swap', () => {
    const faces = (css.match(/@font-face\s*{[^}]*}/g) ?? []).filter((f) => f.includes('url('))
    const urls = faces.flatMap((f) => [...f.matchAll(/url\(\s*['"]?([^'")]+)/g)].map((m) => m[1]))
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) {
      expect(u).toMatch(/^\/fonts\/[^/]+\.woff2$/)
      expect(fontFiles).toContain(u.slice(1))
    }
    for (const f of faces) expect(f).toMatch(/font-display:\s*swap/)
    // No font file ships unused.
    expect([...new Set(urls.map((u) => u.slice(1)))].sort()).toEqual(fontFiles)
  })

  test('pages preload at most two fonts, each one a face uses; no third-party font host', () => {
    for (const f of htmlFiles) {
      const preloads = [...doc(f).querySelectorAll('link[rel="preload"][as="font"]')].map((l) => l.getAttribute('href')!)
      expect(preloads.length, f).toBeLessThanOrEqual(2)
      for (const href of preloads) expect(fontFiles, f).toContain(href.replace(/^\//, ''))
      expect(thirdPartyFonts.test(read(f)), f).toBe(false)
    }
    expect(thirdPartyFonts.test(css)).toBe(false)
  })
})

describe('home header', () => {
  // The header card is the only control for where, when, who and the project type.
  test('each filter has one control', () => {
    const d = doc('index.html')
    const selects = [...d.querySelectorAll('[data-ask] select')]
    expect(selects.map((s) => s.getAttribute('name'))).toEqual(['where', 'within', 'applicant'])
    for (const name of ['where', 'within', 'applicant', 'approach']) {
      expect(d.querySelectorAll(`[data-form] [name="${name}"]`).length, name).toBe(0)
    }
    // Every country in Where knows its region, so a region-wide programme matches it.
    for (const o of d.querySelectorAll('[data-ask] select[name="where"] option')) {
      const v = o.getAttribute('value') ?? ''
      if (v && !v.startsWith('r:')) expect(o.getAttribute('data-region'), v).toBeTruthy()
    }
    const used = new Set([...d.querySelectorAll('tr[data-approach]')].flatMap((r) => r.getAttribute('data-approach')!.split(' ')))
    for (const a of d.querySelectorAll('[data-cat]')) {
      for (const v of (a.getAttribute('data-cat') ?? '').split(' ').filter(Boolean)) expect(used.has(v), v).toBe(true)
    }
  })

  test('no page has a header image', () => {
    for (const f of htmlFiles) expect(doc(f).querySelectorAll('header picture').length, f).toBe(0)
  })
})

describe('programme pages keep the evidence', () => {
  test('each page shows every quote from its data file, with its checked date', () => {
    for (const p of programmes) {
      const d = doc(`p/${p.id}/index.html`)
      const text = norm(d.querySelector('main')!.textContent ?? '')
      const checked = new Set([...d.querySelectorAll('[data-checked]')].map((e) => e.getAttribute('data-checked')))
      for (const e of evidenceOf(p)) {
        expect(text.includes(norm(e.quote)), `${p.id}: quote missing: ${e.quote}`).toBe(true)
        expect(checked.has(e.checked_at), `${p.id}: checked date ${e.checked_at} missing`).toBe(true)
      }
    }
  })
})
