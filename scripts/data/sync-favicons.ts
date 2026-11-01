/// <reference types="bun" />
/**
 * Fetches each organisation's favicon once, at maintenance time, and stores it in public/marks/
 * as a 64×64 WebP, so pages show a small mark beside funders and administrators without any
 * third-party request. Covers every `funder` and `administered_by` in data/programmes, one icon
 * per domain. Writes data/marks.json (src/lib/marks.ts reads it).
 *
 *   bun run sync-favicons                 fetch domains not in the manifest yet; prune unused ones
 *   bun run sync-favicons --refresh       fetch every domain again
 *   bun run sync-favicons --only a.org,b.org
 *
 * Manners: one plain User-Agent that names naturefunding.org, robots.txt honoured for every URL,
 * one attempt per URL with a timeout, no retries, and never a way past a bot check: a blocked
 * site gets the monogram, with the reason recorded.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { loadProgrammes } from '../../src/data/load'
import { domainOf, type MarkEntry } from '../../src/lib/marks'
import { decodeEntities } from './page-text'

const ROOT = join(import.meta.dir, '..', '..')
const MANIFEST = join(ROOT, 'data', 'marks.json')
const OUT_DIR = join(ROOT, 'public', 'marks')

const UA_TOKEN = 'naturefunding-marks'
const USER_AGENT = `${UA_TOKEN}/1.0 (+https://naturefunding.org/about/; fetches each listed organisation's favicon once)`
const TIMEOUT_MS = 15_000
const MAX_PAGE_BYTES = 3_000_000
const MAX_ICON_BYTES = 1_000_000
const SIZE = 64
const MIN_PX = 32
const CONCURRENCY = 4

/**
 * Hand-picked fixes, by domain, after looking at the contact sheet: a better icon URL (still
 * robots-checked and fetched like any other), or a fallback with the reason the fetched one is wrong.
 */
const OVERRIDES: Record<string, { icon: string } | { fallback: string }> = {
  // Checked on the contact sheet, 2026-11-01.
  'fondationfranklinia.org': { fallback: "the site's favicon is the WordPress logo, not the foundation's" },
  'cfhfoundation.grantsmanagement08.com': { fallback: "the grants portal's generic grid icon, not the foundation's" },
}
const HAND = 'checked by hand:'

// ---------- robots.txt ----------

type Rule = { allow: boolean; path: string }

/** The rules that apply to our token in a robots.txt (RFC 9309): its own group, else the `*` group. */
export function robotsRules(text: string, token = UA_TOKEN): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let current: { agents: string[]; rules: Rule[] } | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }))
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if ((key === 'allow' || key === 'disallow') && current) {
      if (value !== '') current.rules.push({ allow: key === 'allow', path: value })
      lastWasAgent = false
    } else lastWasAgent = false
  }
  const ours = token.toLowerCase()
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && (ours.startsWith(a) || a.startsWith('naturefunding'))))
  const chosen = mine.length > 0 ? mine : groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

const patternRe = (path: string) =>
  new RegExp(`^${path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$|\$$/, '$')}`)

/** Longest matching rule wins; on a tie, allow. */
export function robotsAllows(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null
  for (const r of rules) {
    if (!patternRe(r.path).test(pathAndQuery)) continue
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r
  }
  return best ? best.allow : true
}

const robotsCache = new Map<string, Promise<Rule[] | 'unreachable'>>()

function robotsFor(origin: string): Promise<Rule[] | 'unreachable'> {
  let p = robotsCache.get(origin)
  if (!p) {
    p = (async () => {
      try {
        const res = await get(`${origin}/robots.txt`)
        // RFC 9309: a 4xx means no rules; a 5xx or no answer means assume everything is disallowed.
        if (res.status >= 500) return 'unreachable'
        if (res.status >= 400) return []
        return robotsRules(new TextDecoder().decode(await capped(res, 500_000)))
      } catch {
        return 'unreachable'
      }
    })()
    robotsCache.set(origin, p)
  }
  return p
}

async function robotsVerdict(url: string): Promise<string | null> {
  const u = new URL(url)
  const rules = await robotsFor(u.origin)
  if (rules === 'unreachable') return `robots.txt unreachable on ${u.host}`
  return robotsAllows(rules, u.pathname + u.search) ? null : `robots.txt disallows ${u.host}${u.pathname}`
}

// ---------- fetching ----------

function get(url: string, accept = '*/*'): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

async function capped(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.length
    if (n > max) {
      await reader.cancel()
      throw new Error(`larger than ${Math.round(max / 1000)} KB`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Why a response is a bot check or block rather than the page, or null. */
function blockReason(res: Response, body: string): string | null {
  if (res.headers.get('cf-mitigated') === 'challenge') return 'bot check (Cloudflare challenge)'
  const challenge = /just a moment|challenge-platform|cf-chl|attention required|captcha|are you a robot|access denied/i
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    return challenge.test(body) ? `bot check (HTTP ${res.status})` : `blocked (HTTP ${res.status})`
  }
  return null
}

// ---------- icon links ----------

export type Candidate = { url: string; rel: 'icon' | 'apple'; sizes: number | null; svg: boolean; declared: string }

/** The icon links in a page's <head>, resolved against its <base> or URL. Mask icons are skipped. */
export async function iconLinks(html: string, pageUrl: string): Promise<Candidate[]> {
  let base = pageUrl
  const found: { rel: string; href: string; sizes: string; type: string }[] = []
  await new HTMLRewriter()
    .on('base[href]', {
      element: (el) => {
        try {
          base = new URL(decodeEntities(el.getAttribute('href')!), pageUrl).href
        } catch {}
      },
    })
    .on('link[rel][href]', {
      element: (el) => {
        found.push({ rel: el.getAttribute('rel')!, href: decodeEntities(el.getAttribute('href')!), sizes: el.getAttribute('sizes') ?? '', type: el.getAttribute('type') ?? '' })
      },
    })
    .transform(new Response(html))
    .text()
  const out: Candidate[] = []
  for (const l of found) {
    const rels = l.rel.toLowerCase().split(/\s+/)
    const apple = rels.some((r) => r.startsWith('apple-touch-icon'))
    if (!apple && !rels.includes('icon')) continue
    let url: string
    try {
      url = new URL(l.href.trim(), base).href
    } catch {
      continue
    }
    if (!/^(https?|data):/.test(url)) continue
    const svg = /svg/i.test(l.type) || /\.svgz?(\?|#|$)/i.test(url) || url.startsWith('data:image/svg')
    const dims = [...l.sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)].map((m) => Math.min(Number(m[1]), Number(m[2])))
    const sizes = dims.length > 0 ? Math.max(...dims) : null
    if (!out.some((c) => c.url === url)) out.push({ url, rel: apple ? 'apple' : 'icon', sizes, svg, declared: l.rel })
  }
  return out
}

/** Which links to try first: big declared icons and vectors, then touch icons, then the rest. */
function hintRank(c: Candidate): number {
  if (c.svg) return 0
  if (c.rel === 'icon' && c.sizes !== null && c.sizes >= SIZE) return 1
  if (c.rel === 'apple') return 2
  if (c.sizes === null) return 3
  return c.sizes >= MIN_PX ? 4 : 6
}

// ---------- decoding ----------

type Decoded = { input: sharp.Sharp; px: number | null; aspect: number; format: string }

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

/** The largest image in an .ico: its PNG bytes, or its bitmap decoded to RGBA. */
export function decodeIco(buf: Buffer): { png: Buffer } | { rgba: Buffer; width: number; height: number } {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('not an ico')
  const count = buf.readUInt16LE(4)
  let best: { w: number; h: number; bpp: number; size: number; offset: number } | null = null
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16
    const e = { w: buf[o] || 256, h: buf[o + 1] || 256, bpp: buf.readUInt16LE(o + 6), size: buf.readUInt32LE(o + 8), offset: buf.readUInt32LE(o + 12) }
    if (!best || e.w * e.h > best.w * best.h || (e.w * e.h === best.w * best.h && e.bpp > best.bpp)) best = e
  }
  if (!best) throw new Error('empty ico')
  const data = buf.subarray(best.offset, best.offset + best.size)
  if (isPng(data)) return { png: Buffer.from(data) }
  return decodeDib(data, true)
}

/** A Windows bitmap (DIB) to RGBA. In an .ico the height counts the AND mask too, and the mask holds transparency. */
export function decodeDib(data: Buffer, inIco: boolean): { rgba: Buffer; width: number; height: number } {
  const header = data.readUInt32LE(0)
  const width = data.readInt32LE(4)
  const height = Math.abs(data.readInt32LE(8)) / (inIco ? 2 : 1)
  const topDown = !inIco && data.readInt32LE(8) < 0
  const bpp = data.readUInt16LE(14)
  const compression = data.readUInt32LE(16)
  if (compression !== 0 && !(compression === 3 && bpp === 32)) throw new Error(`ico bitmap compression ${compression}`)
  const paletteCount = bpp <= 8 ? data.readUInt32LE(32) || 1 << bpp : 0
  const palette = header
  const pixels = header + paletteCount * 4
  const stride = Math.floor((width * bpp + 31) / 32) * 4
  const mask = pixels + stride * height
  const maskStride = Math.floor((width + 31) / 32) * 4
  const rgba = Buffer.alloc(width * height * 4)
  let anyAlpha = false
  for (let y = 0; y < height; y++) {
    const row = pixels + (topDown ? y : height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      let b = 0, g = 0, r = 0, a = 255
      if (bpp === 32) [b, g, r, a] = [data[row + x * 4]!, data[row + x * 4 + 1]!, data[row + x * 4 + 2]!, data[row + x * 4 + 3]!]
      else if (bpp === 24) [b, g, r] = [data[row + x * 3]!, data[row + x * 3 + 1]!, data[row + x * 3 + 2]!]
      else if (bpp <= 8) {
        const bit = x * bpp
        const idx = (data[row + (bit >> 3)]! >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1)
        const p = palette + idx * 4
        ;[b, g, r] = [data[p]!, data[p + 1]!, data[p + 2]!]
      } else throw new Error(`ico bitmap ${bpp} bpp`)
      if (bpp === 32 && a > 0) anyAlpha = true
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = a
    }
  }
  // A plain 32-bit bitmap with no alpha in use is opaque.
  if (!inIco && bpp === 32 && !anyAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  // Without real alpha, the AND mask says which pixels are transparent.
  if (inIco && !anyAlpha && mask + maskStride * height <= data.length) {
    for (let y = 0; y < height; y++) {
      const row = mask + (height - 1 - y) * maskStride
      for (let x = 0; x < width; x++) {
        const transparent = (data[row + (x >> 3)]! >> (7 - (x & 7))) & 1
        rgba[(y * width + x) * 4 + 3] = transparent ? 0 : 255
      }
    }
  }
  return { rgba, width, height }
}

async function decode(bytes: Buffer): Promise<Decoded> {
  const head = bytes.subarray(0, 512).toString('utf8')
  if (bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1) {
    const ico = decodeIco(bytes)
    if ('png' in ico) return { ...(await decode(ico.png)), format: 'ico' }
    return { input: sharp(ico.rgba, { raw: { width: ico.width, height: ico.height, channels: 4 } }), px: Math.min(ico.width, ico.height), aspect: ico.width / ico.height, format: 'ico' }
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    // A .bmp served as the favicon: the pixels start after the 14-byte file header.
    const bmp = decodeDib(bytes.subarray(14), false)
    return { input: sharp(bmp.rgba, { raw: { width: bmp.width, height: bmp.height, channels: 4 } }), px: Math.min(bmp.width, bmp.height), aspect: bmp.width / bmp.height, format: 'ico' }
  }
  if (/<svg[\s>]/i.test(bytes.toString('utf8')) && !isPng(bytes)) {
    // Vector: rasterised here, never shipped as SVG, so nothing in it can run on our pages.
    const meta = await sharp(bytes).metadata()
    const long = Math.max(meta.width ?? SIZE, meta.height ?? SIZE)
    const density = Math.min(2400, Math.max(72, Math.ceil((72 * SIZE * 4) / long)))
    const w = meta.width ?? 1
    const h = meta.height ?? 1
    return { input: sharp(bytes, { density }), px: null, aspect: w / h, format: 'svg' }
  }
  if (/^\s*</.test(head)) throw new Error('an HTML page, not an image')
  const meta = await sharp(bytes, { animated: false }).metadata()
  if (!meta.width || !meta.height) throw new Error('unreadable image')
  return { input: sharp(bytes, { animated: false }), px: Math.min(meta.width, meta.height), aspect: meta.width / meta.height, format: meta.format ?? 'image' }
}

/** Encodes to the stored 64×64 WebP, or says why the image is unusable. */
async function normalise(d: Decoded): Promise<Buffer> {
  if (d.aspect > 2 || d.aspect < 0.5) throw new Error(`not square (${d.aspect.toFixed(2)}:1)`)
  const square = await d.input
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: (d.px ?? SIZE) < MIN_PX ? 'nearest' : (d.px ?? SIZE) < SIZE ? 'cubic' : 'lanczos3' })
    .ensureAlpha()
    .png()
    .toBuffer()
  const { channels } = await sharp(square).stats()
  const alpha = channels[3]!
  if (alpha.max < 16) throw new Error('blank (fully transparent)')
  const flat = channels.slice(0, 3).every((c) => c.stdev < 2) && alpha.stdev < 2
  if (flat) throw new Error('blank (one flat colour)')
  const [lossless, lossy] = await Promise.all([
    sharp(square).webp({ lossless: true, effort: 6 }).toBuffer(),
    sharp(square).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer(),
  ])
  return lossless.length <= lossy.length ? lossless : lossy
}

// ---------- one domain ----------

type Tried = { c: Candidate | { url: string; rel: 'ico'; sizes: null; svg: false; declared: string }; webp?: Buffer; px?: number | null; error?: string }

function dataUrlBytes(url: string): Buffer {
  const m = url.match(/^data:([^,]*?)(;base64)?,(.*)$/s)
  if (!m) throw new Error('bad data URL')
  return m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!), 'utf8')
}

async function fetchIcon(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) return dataUrlBytes(url)
  const disallowed = await robotsVerdict(url)
  if (disallowed) throw new Error(disallowed)
  const res = await get(url, 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5')
  const bytes = Buffer.from(await capped(res, MAX_ICON_BYTES))
  const blocked = blockReason(res, bytes.subarray(0, 4000).toString('utf8'))
  if (blocked) throw new Error(blocked)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return bytes
}

async function syncDomain(domain: string, homepage: string, orgs: string[]): Promise<MarkEntry> {
  const fetched_at = new Date().toISOString()
  const entry = (fields: Partial<MarkEntry>): MarkEntry => ({
    domain, orgs, homepage, source: null, source_px: null, fetched_at, file: null, bytes: null, fallback: null, ...fields,
  })
  const override = OVERRIDES[domain]
  if (override && 'fallback' in override) return entry({ fallback: `${HAND} ${override.fallback}` })

  let candidates: Tried['c'][] = []
  let pageNote: string | null = null
  if (override && 'icon' in override) {
    candidates = [{ url: override.icon, rel: 'icon', sizes: null, svg: /\.svg/i.test(override.icon), declared: 'override' }]
  } else {
    const disallowed = await robotsVerdict(homepage)
    if (disallowed) return entry({ fallback: disallowed })
    let finalUrl = homepage
    try {
      const res = await get(homepage, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5')
      finalUrl = res.url || homepage
      const html = new TextDecoder().decode(await capped(res, MAX_PAGE_BYTES))
      const blocked = blockReason(res, html.slice(0, 20_000))
      if (blocked) return entry({ fallback: `homepage: ${blocked}` })
      if (!res.ok) pageNote = `homepage HTTP ${res.status}`
      else candidates = (await iconLinks(html, finalUrl)).sort((a, b) => hintRank(a) - hintRank(b)).slice(0, 5)
    } catch (e) {
      pageNote = `homepage: ${(e as Error).message}`
    }
    const ico = new URL('/favicon.ico', finalUrl).href
    if (!candidates.some((c) => c.url === ico)) candidates.push({ url: ico, rel: 'ico', sizes: null, svg: false, declared: '/favicon.ico' })
  }

  const tried: Tried[] = []
  for (const c of candidates) {
    try {
      const d = await decode(await fetchIcon(c.url))
      // A square source of at least 32 px; a classic .ico (or .bmp) is the last resort at any size from 16.
      const min = c.rel === 'ico' || d.format === 'ico' ? 16 : MIN_PX
      if (d.px !== null && d.px < min) throw new Error(`too small (${d.px}px)`)
      tried.push({ c, webp: await normalise(d), px: d.px })
    } catch (e) {
      tried.push({ c, error: (e as Error).message })
    }
  }
  const ok = tried.filter((t) => t.webp)
  const rank = (t: Tried) => {
    const big = t.px === null || (t.px ?? 0) >= SIZE ? 0 : 1
    const kind = t.c.rel === 'icon' ? 0 : t.c.rel === 'apple' ? 1 : 2
    return big * 10 + kind
  }
  ok.sort((a, b) => rank(a) - rank(b) || (b.px ?? 9999) - (a.px ?? 9999))
  const best = ok[0]
  if (!best) {
    const why = [pageNote, ...tried.map((t) => `${shortUrl(t.c.url)}: ${t.error}`)].filter(Boolean).join('; ')
    return entry({ fallback: `no usable icon (${why || 'no icon links'})` })
  }
  const file = `marks/${domain}.webp`
  writeFileSync(join(ROOT, 'public', file), best.webp!)
  return entry({ source: best.c.url.startsWith('data:') ? `${best.c.url.slice(0, 40)}… (inline in ${homepage})` : best.c.url, source_px: best.px ?? null, file, bytes: best.webp!.length })
}

const shortUrl = (u: string) => (u.startsWith('data:') ? 'inline data URL' : u.replace(/^https?:\/\//, ''))

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2)
  const refresh = args.includes('--refresh')
  const onlyArg = args.find((a) => a.startsWith('--only'))
  const only = onlyArg ? new Set((onlyArg.includes('=') ? onlyArg.split('=')[1]! : args[args.indexOf(onlyArg) + 1] ?? '').split(',').filter(Boolean)) : null

  // Every organisation with a URL, grouped by domain; the first URL seen gives the homepage's origin.
  const byDomain = new Map<string, { homepage: string; orgs: Set<string> }>()
  for (const p of loadProgrammes()) {
    for (const org of [p.funder, p.administered_by]) {
      if (!org?.url) continue
      const domain = domainOf(org.url)
      if (!domain) continue
      const d = byDomain.get(domain) ?? { homepage: `${new URL(org.url).origin}/`, orgs: new Set<string>() }
      d.orgs.add(org.name)
      byDomain.set(domain, d)
    }
  }

  const old: Record<string, MarkEntry> = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}
  mkdirSync(OUT_DIR, { recursive: true })
  const next: Record<string, MarkEntry> = {}
  const todo: string[] = []
  for (const [domain, d] of byDomain) {
    const orgs = [...d.orgs].sort()
    const prev = old[domain]
    const override = OVERRIDES[domain]
    const overrideChanged =
      override && ('icon' in override ? prev?.source !== override.icon : prev?.fallback !== `${HAND} ${override.fallback}`)
    // An override taken out: fetch the site's own icon again.
    const overrideRemoved = !override && !!prev?.fallback?.startsWith(HAND)
    const fileOk = prev?.file ? existsSync(join(ROOT, 'public', prev.file)) : !!prev?.fallback
    const wanted = only ? only.has(domain) : refresh || !prev || !fileOk || overrideChanged || overrideRemoved
    if (wanted) todo.push(domain)
    else next[domain] = { ...prev!, orgs, homepage: prev!.homepage ?? d.homepage }
  }

  let i = 0
  const work = async () => {
    for (;;) {
      const domain = todo[i++]
      if (!domain) return
      const d = byDomain.get(domain)!
      const e = await syncDomain(domain, d.homepage, [...d.orgs].sort())
      if (e.fallback && old[domain]?.file && !OVERRIDES[domain]) {
        // A refetch that fails keeps the icon we already hold rather than dropping to the monogram.
        next[domain] = { ...old[domain]!, orgs: e.orgs }
        console.log(`kept  ${domain}  (refetch failed: ${e.fallback})`)
        continue
      }
      next[domain] = e
      console.log(e.file ? `icon  ${domain}  ${e.bytes} B from ${shortUrl(e.source!)}` : `mono  ${domain}  ${e.fallback}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, work))

  // Drop files no entry names (an org that left the data, or a domain that now falls back).
  const named = new Set(Object.values(next).map((e) => e.file?.replace(/^marks\//, '')).filter(Boolean))
  for (const f of readdirSync(OUT_DIR)) if (!named.has(f)) rmSync(join(OUT_DIR, f))

  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]!]))
  writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`)

  const entries = Object.values(sorted)
  const icons = entries.filter((e) => e.file)
  const total = icons.reduce((n, e) => n + statSync(join(ROOT, 'public', e.file!)).size, 0)
  console.log(`\n${entries.length} domains: ${icons.length} icons, ${entries.length - icons.length} monograms; ${todo.length} fetched this run`)
  console.log(`public/marks: ${total} bytes (${(total / 1024).toFixed(1)} KB), largest ${Math.max(0, ...icons.map((e) => e.bytes ?? 0))} B`)
}

if (import.meta.main) await main()
