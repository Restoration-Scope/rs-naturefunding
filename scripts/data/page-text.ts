/// <reference types="bun" />
/**
 * Fetches a funder page and turns it into the plain text quotes are checked against.
 * Used by verify-quotes, sync-sources and the seeding agents, so a quote copied from
 * `bun scripts/data/page-text.ts <url>` is exactly what the checker sees.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_DIR = join(process.cwd(), '.cache', 'pages')
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 naturefunding.org-checker'

const DROPPED = 'script, style, noscript, template, svg, iframe, head'
const BLOCKS =
  'address, article, aside, blockquote, br, dd, details, div, dl, dt, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, summary, table, tbody, td, th, thead, tr, ul'

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...',
  lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"', laquo: '«', raquo: '»',
  euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™', deg: '°', middot: '·',
  bull: '•', times: '×', shy: '', zwj: '', zwnj: '', thinsp: ' ', ensp: ' ', emsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', egrave: 'è', ograve: 'ò',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', acirc: 'â', ecirc: 'ê', ocirc: 'ô', ccedil: 'ç',
  ntilde: 'ñ', atilde: 'ã', otilde: 'õ', szlig: 'ß', Aacute: 'Á', Eacute: 'É', Oacute: 'Ó', Uacute: 'Ú',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED[e] ?? m
  })
}

/** Folds typography so a quote matches whatever quote marks, dashes and spaces the page used. */
export function normalise(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export const comparable = (s: string) => normalise(s).toLowerCase()

export async function htmlToText(html: string, selector: string | null = null): Promise<string> {
  const cleaned = await new HTMLRewriter()
    .on(DROPPED, { element: (el) => { el.remove() } })
    .on(BLOCKS, { element: (el) => { el.before('\n'); el.after('\n') } })
    .transform(new Response(html))
    .text()
  let text = ''
  let matched = false
  await new HTMLRewriter()
    .on(selector ?? 'body', { element: () => { matched = true }, text: (t) => { text += t.text } })
    .transform(new Response(cleaned))
    .text()
  if (!matched && selector) throw new Error(`selector ${selector} matched nothing`)
  if (!matched) text = cleaned.replace(/<[^>]*>/g, ' ')
  return normalise(decodeEntities(text))
}

export type Page = { url: string; status: number; contentType: string; text: string; fetchedAt: string }

type Cached = { url: string; status: number; contentType: string; fetchedAt: string; file: string }

const key = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 24)

async function fetchRaw(url: string, fresh: boolean): Promise<{ meta: Cached; bytes: Buffer }> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const metaPath = join(CACHE_DIR, `${key(url)}.json`)
  const today = new Date().toISOString().slice(0, 10)
  if (!fresh && existsSync(metaPath)) {
    const meta: Cached = JSON.parse(readFileSync(metaPath, 'utf8'))
    if (meta.fetchedAt.slice(0, 10) === today) return { meta, bytes: readFileSync(join(CACHE_DIR, meta.file)) }
  }
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'accept-language': 'en' },
    signal: AbortSignal.timeout(45_000),
  })
  const bytes = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') ?? ''
  const isPdf = contentType.includes('pdf') || bytes.subarray(0, 4).toString() === '%PDF'
  const meta: Cached = { url, status: res.status, contentType: isPdf ? 'application/pdf' : contentType, fetchedAt: new Date().toISOString(), file: `${key(url)}.${isPdf ? 'pdf' : 'html'}` }
  writeFileSync(join(CACHE_DIR, meta.file), bytes)
  writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  return { meta, bytes }
}

function pdfToText(file: string): string {
  const run = Bun.spawnSync(['pdftotext', '-enc', 'UTF-8', file, '-'])
  if (run.exitCode !== 0) throw new Error(`pdftotext failed: ${run.stderr.toString().trim()}`)
  return normalise(run.stdout.toString())
}

export async function fetchPage(url: string, opts: { selector?: string | null; fresh?: boolean } = {}): Promise<Page> {
  const { meta, bytes } = await fetchRaw(url, opts.fresh ?? false)
  if (meta.status >= 400) throw new Error(`HTTP ${meta.status}`)
  const text = meta.contentType === 'application/pdf'
    ? pdfToText(join(CACHE_DIR, meta.file))
    : await htmlToText(bytes.toString('utf8'), opts.selector ?? null)
  return { url, status: meta.status, contentType: meta.contentType, text, fetchedAt: meta.fetchedAt }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i === -1 ? null : args.splice(i, 2)[1] ?? null
  }
  const selector = flag('--selector')
  const grep = flag('--grep')
  const fresh = args.includes('--fresh')
  const url = args.find((a) => !a.startsWith('--'))
  if (!url) {
    console.error('usage: bun scripts/data/page-text.ts <url> [--selector css] [--grep word] [--fresh]')
    process.exit(2)
  }
  const page = await fetchPage(url, { selector, fresh })
  if (!grep) console.log(page.text)
  else {
    const lower = page.text.toLowerCase()
    const needle = grep.toLowerCase()
    let i = lower.indexOf(needle)
    if (i === -1) console.log(`(no match for "${grep}")`)
    while (i !== -1) {
      console.log(`… ${page.text.slice(Math.max(0, i - 300), i + 300)} …\n`)
      i = lower.indexOf(needle, i + needle.length)
    }
  }
  console.error(`[${page.status} ${page.contentType} ${page.text.length} chars]`)
}
