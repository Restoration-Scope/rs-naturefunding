/**
 * Stage 2, gather: the programme's own pages and the documents they link (guidelines, call text, FAQs),
 * in a bounded crawl. Code ranks links by what they say; Jev ranks the ones code can't place and confirms
 * a document is about this programme from its own text. Every document keeps where it was linked from.
 * Anything that stops a full read (the bound, a failed fetch, a scanned PDF, a page that needs a browser)
 * marks coverage incomplete, so the programme is never stamped requirements_checked on a partial read.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Programme, Source } from '../../src/data/schema'
import { comparable, normalise } from '../../src/data/text'
import { officeText } from '../data/convert'
import { decodeEntities, htmlToText } from '../data/page-text'
import { lowTextPdf, readPdf, type Ocr, type PdfRead } from '../data/pdf'
import { siteOf } from '../refresh/discover-web'
import { fetchRaw, hashText, HOST_GAP_MS, type FailureKind } from '../refresh/fetch'

export { lowTextPdf, scannedPages } from '../data/pdf'
import type { AskJev } from './models'

export const BOUNDS = { depth: 2, documents: 8 }
/** Jev's P(link holds this programme's rules) needed to follow a link, by what code made of it. Tuned on the gold set. */
export const LINK_THRESHOLD = { strong: 0.3, ambiguous: 0.5 }

export type Link = { href: string; text: string; context: string }

export type Doc = {
  /** D1, D2…: how prompts and answers name it. */
  ref: string
  url: string
  final_url: string
  /** The page that linked it, and the link's words; null for a seed. */
  from: string | null
  anchor: string | null
  depth: number
  pdf: boolean
  /** The text quotes are checked against, as verify-quotes extracts it (no selector). */
  text: string
  /** A PDF's pages; null for HTML. */
  pages: string[] | null
  /** The text inside the watch list's selector, when the page has one; a quote outside it would look gone to the refresh. */
  selected: string | null
  links: Link[]
  hash: string
  low_text: boolean
}

export type Failure = { url: string; from: string | null; kind: FailureKind | 'low_text' | 'bound' | 'off_topic' | 'offsite'; message: string }

export type Gathered = {
  docs: Doc[]
  failures: Failure[]
  /** Links considered and not followed, by reason, for the manifest. */
  skipped: { url: string; why: string }[]
  complete: boolean
  reasons: string[]
}

/** Words that mark a link to what an applicant must meet or submit, in the languages we list. */
const RELEVANT =
  /guideline|guidance|guide\b|checklist|attachments?\b|annex(?:es)?\b|enclosures?|supporting documents|required documents|match(?:ing)? form|bijlage|anlage|pi[eè]ces (?:justificatives|à joindre)|anexos?\b|\ballegat[oi]\b|handbook|manual|(?:call|requests?) for (?:proposals|applications)|eligib|criteria|how to apply|application|\bRFA\b|\bRFP\b|apply|faq|frequently asked|terms and conditions|conditions|rules|requirements|prospectus|(?:grants?|grant-?making|funding|fund|eligibility|applicants?|application|indirect[ -]costs?|safeguard(?:ing)?|procurement|programme|program)\b[\w ,&-]{0,25}?polic(?:y|ies)|polic(?:y|ies) (?:on|for)\b|programme document|funding information|grant agreement|reporting|richtlinie|merkblatt|leitfaden|förderaufruf|ausschreibung|antrag|förderbedingungen|voraussetzung|bases|convocatoria|requisitos|reglamento|gu[ií]a|criterios|solicitud|edital|regulamento|lignes directrices|appel à projets|règlement|cahier des charges|conditions d'éligibilité|dossier de candidature|subsidieregeling|voorwaarden|aanvragen|regeling|beleidsregel|bando|regolamento|募集要項|要綱|応募|助成|ansøg|retningslinjer|søknad|riktlinjer|ansökan|villkor|hakuohje|tukiehdot/i

const NOISE =
  /annual report|news|press|blog|event|privacy|cookie|login|log in|sign in|donat|career|job|vacanc|newsletter|subscribe|twitter|facebook|linkedin|instagram|youtube|past (?:grantees|recipients|projects)|grantees|recipients|awarded|results|winners|impressum|datenschutz|kontakt|contact|sitemap/i

/**
 * A site's own legal and account pages, linked from every page's footer: never a programme's rules, whatever
 * else their words match ("Privacy Policy", "Conditions of Use"). Tested on the link's words and the URL's
 * last segment, before relevance. Bare "Terms and Conditions" is not here: funders put grant terms under that name.
 */
export const SITE_PAGE =
  /privacy|cookie|data[ -]protection|datenschutz|impressum|integritetspolicy|個人情報|legal[ -]notice|mentions[ -]l[ée]gales|aviso[ -]legal|terms[ -]of[ -](?:use|service|sale)|conditions[ -]of[ -]use|conditions[ -]d'utilisation|website[ -]terms|\buse[ -]policy|accessibility|disclaimer|copyright|refund[ -]polic|(?:sms|mobile)[ -]terms|sitemap/i

/** Not a page: mail, phone, script and anchor links, media files, and "share this page" buttons (`?share=facebook`). */
const SKIP_HREF = /^(?:mailto:|tel:|javascript:|#)|\.(?:jpe?g|png|gif|svg|webp|zip|mp4|mp3)(?:$|\?)|[?&]share=/i
const DOC_HREF = /\.(?:pdf|docx?|odt|rtf)(?:$|[?#])/i
const SOCIAL = /(?:facebook|twitter|x|linkedin|instagram|youtube|tiktok|flickr|vimeo)\.com$/i

const LANGS = new Set('en es pt fr de it nl ja zh ko ru ar sv da no nb nn fi pl cs sk hu ro bg el tr id vi th uk hr sl et lv lt is ga cy ca eu gl'.split(' '))
/** The language segment a site puts first in its paths ("/pt/faq"), if any. */
const langOf = (path: string) => {
  const m = /^\/([a-z]{2})(?:[-_][a-z]{2})?(?:\/|$)/i.exec(path)
  return m && LANGS.has(m[1]!.toLowerCase()) ? m[1]!.toLowerCase() : null
}

/** One key for a URL however it is written: no fragment, no trailing slash. */
export const urlKey = (u: string) => u.replace(/#.*$/, '').replace(/\/(?=$|\?)/, '')

const site = siteOf

/**
 * Hosts that only serve a site's own uploaded files (Widen, Wix, Squarespace, Storyblok, Contentful, HubSpot):
 * a file there linked from the funder's page is the funder's, as when its own link redirects there.
 */
const FILE_HOST = /(?:^|\.)(?:widen\.net|widencollective\.com|widencdn\.net|filesusr\.com|wixstatic\.com|squarespace(?:-cdn)?\.com|storyblok\.com|ctfassets\.net|hubspotusercontent[\w-]*\.(?:net|com))$/i
export const isFileHost = (host: string) => FILE_HOST.test(host)

/** `offsite`: a page on another site whose link is about applying; it is ranked like any link, but never read: a kept one blocks the stamp. */
export type Candidate = Link & { url: string; score: 'strong' | 'ambiguous' | 'offsite' | 'skip'; why: string; offsite?: true }

const segs = (p: string) => decodeURIComponent(p).split('/').filter(Boolean)

/** How many leading folders a link shares with a page on its host; the link keeps at least its own last segment. */
export function sharedFolders(u: URL, page: string): number {
  const other = URL.parse(page)
  if (!other || other.hostname !== u.hostname) return 0
  const mine = segs(u.pathname)
  const folders = segs(other.pathname)
  let n = 0
  while (n < folders.length && n < mine.length - 1 && folders[n] === mine[n]) n++
  return n
}

/** The segments of a link's path past the longest folder prefix it shares with any of these pages on its host. */
export function ownPath(u: URL, pages: string[]): string {
  const shared = Math.max(0, ...pages.map((page) => sharedFolders(u, page)))
  return segs(u.pathname).slice(shared).join('/')
}

/** What code can say about a link: follow it, ask Jev, or skip it, and why. */
export function classifyLink(link: Link, pageUrl: string, programme: Pick<Programme, 'name' | 'url'>): Candidate {
  let url: string
  try {
    url = new URL(link.href, pageUrl).toString().replace(/#.*$/, '')
  } catch {
    return { ...link, url: link.href, score: 'skip', why: 'not a URL' }
  }
  const u = new URL(url)
  if (SKIP_HREF.test(link.href) || !/^https?:$/.test(u.protocol)) return { ...link, url, score: 'skip', why: 'not a page' }
  if (SOCIAL.test(u.hostname)) return { ...link, url, score: 'skip', why: 'social media' }
  if (urlKey(url) === urlKey(pageUrl)) return { ...link, url, score: 'skip', why: 'same page' }
  const path = decodeURIComponent(u.pathname)
  if (SITE_PAGE.test(link.text) || SITE_PAGE.test(path.split('/').filter(Boolean).at(-1) ?? '')) return { ...link, url, score: 'skip', why: 'privacy, cookie, legal or site terms page' }
  const fileHost = isFileHost(u.hostname)
  const sameSite = fileHost || site(u.hostname) === site(new URL(pageUrl).hostname) || site(u.hostname) === site(new URL(programme.url).hostname)
  // The same page in another language spends the crawl bound on text already read.
  const lang = langOf(u.pathname)
  if (sameSite && lang && lang !== langOf(new URL(pageUrl).pathname)) return { ...link, url, score: 'skip', why: 'another language' }
  const doc = DOC_HREF.test(url) || fileHost
  // The path counts only past the folders it shares with the programme's own page: a sibling programme under
  // /grants/funding-applications/ is not about applying because its folder is. Folders shared only with the
  // linking page still count (CEPF's /grants/before-you-apply/ pages are guidance for every applicant).
  const words = `${link.text} ${ownPath(u, [programme.url])}`
  const relevant = RELEVANT.test(words) || (RELEVANT.test(link.context) && doc)
  const named = comparable(link.text).length > 3 && comparable(`${link.text} ${link.context}`).includes(comparable(programme.name).slice(0, 40))
  if (NOISE.test(link.text) && !relevant) return { ...link, url, score: 'skip', why: 'news, contact or account page' }
  // A document on another host counts only as the funder's own: linked straight from its page, and about the programme by Jev.
  const off = sameSite ? {} : { offsite: true as const }
  if (relevant && (doc || sameSite)) return { ...link, url, ...off, score: 'strong', why: doc ? 'a document whose link names rules or guidance' : 'a page whose link names rules or guidance' }
  if (doc && (sameSite || named)) return { ...link, url, ...off, score: 'ambiguous', why: 'a document the link doesn’t describe' }
  // An application portal or guide on another site may hold rules we can't vouch for as the funder's: never read, never silently dropped.
  if (relevant || named) return { ...link, url, offsite: true, score: 'offsite', why: 'a page on another site about applying' }
  if (sameSite && (named || RELEVANT.test(link.context))) return { ...link, url, score: 'ambiguous', why: 'a page near words about applying' }
  return { ...link, url, score: 'skip', why: sameSite ? 'unrelated page' : 'another site' }
}

/** The page's links with their words and the text around them, from the HTML. A page's `<base href>` resolves its relative links, as a browser does. */
export async function linksFrom(html: string, pageUrl?: string): Promise<Link[]> {
  const hrefs: string[] = []
  let base: string | null = null
  const marked = await new HTMLRewriter()
    .on('base[href]', {
      element(el) {
        base ??= decodeEntities(el.getAttribute('href') ?? '')
      },
    })
    .on('a[href]', {
      element(el) {
        // The rewriter hands attributes back raw: `&amp;` in an href is a plain `&` in the URL.
        const n = hrefs.push(decodeEntities(el.getAttribute('href') ?? '')) - 1
        el.before(` ⟦L${n}⟧ `)
        el.after(` ⟦/L${n}⟧ `)
      },
    })
    .transform(new Response(html))
    .text()
  const text = await htmlToText(marked)
  const baseUrl = base && pageUrl ? URL.parse(base, pageUrl) : null
  const out: Link[] = []
  for (const [n, raw] of hrefs.entries()) {
    const href = baseUrl && !/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(raw) ? (URL.parse(raw, baseUrl)?.toString() ?? raw) : raw
    const start = text.indexOf(`⟦L${n}⟧`)
    const end = text.indexOf(`⟦/L${n}⟧`)
    if (start === -1 || end === -1) continue
    const clean = (s: string) => normalise(s.replace(/⟦\/?L\d+⟧/g, ' '))
    out.push({
      href,
      text: clean(text.slice(start + `⟦L${n}⟧`.length, end)).slice(0, 200),
      context: clean(text.slice(Math.max(0, start - 200), Math.min(text.length, end + 200))).slice(0, 500),
    })
  }
  return out
}

/** The failures for a PDF's image pages OCR left unread, one per reason: "pages 3, 4 are images: needs OCR (…)". */
export function unreadPages(read: PdfRead, url: string, from: string | null): Failure[] {
  const byWhy = new Map<string, number[]>()
  for (const u of read.unread) byWhy.set(u.why, [...(byWhy.get(u.why) ?? []), u.page])
  return [...byWhy].map(([why, pages]) => ({ url, from, kind: 'low_text', message: `page${pages.length > 1 ? 's' : ''} ${pages.join(', ')} ${pages.length > 1 ? 'are images' : 'is an image'}: ${why}` }))
}

export type Reader = (url: string) => Promise<
  | { ok: true; finalUrl: string; pdf: boolean; html: string; bytes: Uint8Array }
  | { ok: false; kind: FailureKind; message: string }
>

/** The polite reader with a per-host gap and a day's cache on disk, so reruns don't refetch. */
export function politeReader(cacheDir: string | null, gapMs = HOST_GAP_MS): Reader {
  const last = new Map<string, number>()
  if (cacheDir) mkdirSync(cacheDir, { recursive: true })
  return async (url) => {
    const day = new Date().toISOString().slice(0, 10)
    const key = createHash('sha256').update(`${day} ${url}`).digest('hex').slice(0, 24)
    const meta = cacheDir && join(cacheDir, `${key}.json`)
    if (meta && existsSync(meta)) {
      const m = JSON.parse(readFileSync(meta, 'utf8'))
      if (!m.ok) return m
      return { ...m, bytes: new Uint8Array(readFileSync(join(cacheDir!, `${key}.bin`))) }
    }
    const host = new URL(url).host
    const wait = (last.get(host) ?? 0) + gapMs - Date.now()
    if (wait > 0) await Bun.sleep(wait)
    last.set(host, Date.now())
    const raw = await fetchRaw(url)
    const out = raw.ok
      ? { ok: true as const, finalUrl: raw.finalUrl, pdf: raw.pdf, html: raw.body, bytes: raw.bytes }
      : { ok: false as const, kind: raw.kind, message: raw.message }
    if (meta) {
      if (out.ok) {
        writeFileSync(join(cacheDir!, `${key}.bin`), out.bytes)
        writeFileSync(meta, JSON.stringify({ ...out, bytes: undefined }))
      } else if (out.kind !== 'timeout' && out.kind !== 'network') writeFileSync(meta, JSON.stringify(out))
    }
    return out
  }
}

/** Words that name a kind of funding, not a programme: what is left of a name after the funder's must say more. */
const GENERIC_NAME = new Set('the a an of for and our grant grants fund funds funding programme programmes program programs scheme schemes call calls foundation trust'.split(' '))

/**
 * How a document names this programme, folded for matching: its full name, and its name without the funder's or
 * administrator's ("Keystone Grants" for "Save Our Seas Foundation Keystone Grants") when what is left still
 * says which programme. Never the funder's name alone.
 */
export function programmeNames(p: Pick<Programme, 'name' | 'funder' | 'administered_by'>): string[] {
  const full = comparable(p.name)
  let short = full
  for (const org of [p.funder.name, p.administered_by?.name]) if (org) short = short.replace(comparable(org), ' ')
  short = normalise(short).replace(/^[\s,:–—-]+|[\s,:–—-]+$/g, '')
  const distinctive = short.split(/[^\p{L}\p{N}]+/u).some((w) => w.length > 1 && !GENERIC_NAME.has(w))
  return [...new Set([full.slice(0, 50), ...(distinctive && short.length > 4 ? [short.slice(0, 50)] : [])])].filter((n) => n.length > 4)
}

/** The pages a programme cites: its main page, its calls' pages and every evidence source. */
export function seedsOf(p: Programme): string[] {
  const all = [p.url, ...p.calls.map((c) => c.url), ...Object.values(p.evidence).flat().map((e) => e!.source_url)]
  for (const c of p.calls) for (const e of Object.values(c.evidence)) if (e) all.push(e.source_url)
  const keys = new Set<string>()
  return all.map((u) => u.replace(/#.*$/, '')).filter((u) => (keys.has(urlKey(u)) ? false : (keys.add(urlKey(u)), true)))
}

export async function gather(
  p: Programme,
  opts: { read: Reader; sources: Source[]; jev?: AskJev | null; bounds?: typeof BOUNDS; extra?: string[]; ocr?: Ocr | null },
): Promise<Gathered> {
  const bounds = opts.bounds ?? BOUNDS
  const docs: Doc[] = []
  const failures: Failure[] = []
  const skipped: { url: string; why: string }[] = []
  const seen = new Set<string>()
  const reasons: string[] = []

  async function open(url: string, from: string | null, anchor: string | null, depth: number): Promise<Doc | null> {
    seen.add(urlKey(url))
    const r = await opts.read(url)
    if (!r.ok) {
      failures.push({ url, from, kind: r.kind, message: r.message })
      return null
    }
    // A redirect to a page already read adds nothing.
    if (urlKey(r.finalUrl) !== urlKey(url) && seen.has(urlKey(r.finalUrl))) return null
    seen.add(urlKey(r.finalUrl))
    let text: string
    let pages: string[] | null = null
    let links: Link[] = []
    let selected: string | null = null
    let pdf: PdfRead | null = null
    try {
      const office = r.pdf ? null : officeText(r.bytes)
      if (office) text = normalise(office.text)
      else if (r.pdf) {
        pdf = readPdf(r.bytes, opts.ocr === undefined ? {} : { ocr: opts.ocr, cacheDir: null })
        pages = pdf.pages
        text = normalise(pages.join('\n'))
      } else if (/\.(?:docx?|odt|rtf|xlsx?|pptx?)(?:$|[?#])/i.test(r.finalUrl) && !/<html|<!doctype/i.test(r.html.slice(0, 2000))) {
        failures.push({ url, from, kind: 'unreadable', message: 'a link to an office file that sent neither a document nor a page' })
        return null
      } else {
        text = await htmlToText(r.html)
        links = await linksFrom(r.html, r.finalUrl)
        const selector = opts.sources.find((s) => s.programme_id === p.id && s.url === url)?.selector
        if (selector) selected = await htmlToText(r.html, selector).catch(() => null)
      }
    } catch (e) {
      failures.push({ url, from, kind: 'unreadable', message: (e as Error).message })
      return null
    }
    // A PDF is low on text after OCR has read what it can: what is left is unread scans, or photos and blanks.
    const low = pages ? lowTextPdf(pages) : text.length < 300
    const doc: Doc = { ref: `D${docs.length + 1}`, url, final_url: r.finalUrl, from, anchor, depth, pdf: r.pdf, text, pages, selected, links, hash: hashText(text), low_text: low }
    if (low && pdf?.unread.length) failures.push({ url, from, kind: 'low_text', message: `a scanned or image PDF: ${pdf.unread[0]!.why}` })
    else if (low) failures.push({ url, from, kind: 'low_text', message: r.pdf ? 'a PDF with almost no text, even read by OCR' : 'too little text: the page may need a browser' })
    else if (pdf) failures.push(...unreadPages(pdf, url, from))
    docs.push(doc)
    return doc
  }

  for (const url of seedsOf(p)) if (!seen.has(urlKey(url))) await open(url, null, null, 0)
  // Pages a first reader (GPT Pro) says it read: opened outside the crawl bound, held to the same about-check as
  // a followed link, and not crawled further. One that won't open blocks the stamp like any other.
  for (const url of opts.extra ?? []) if (/^https?:\/\//.test(url) && !seen.has(urlKey(url))) await open(url.replace(/#.*$/, ''), 'first reader', null, 1)

  let followed = 0
  let frontier = docs.filter((d) => !d.pdf && d.depth === 0)
  // One level past the bound is ranked but not opened: a kept link there blocks the stamp instead of vanishing.
  for (let depth = 1; depth <= bounds.depth + 1 && frontier.length; depth++) {
    const next: Doc[] = []
    const candidates = new Map<string, Candidate & { from: string }>()
    for (const d of frontier) {
      for (const l of d.links) {
        const c = classifyLink(l, d.final_url, p)
        if (seen.has(urlKey(c.url)) || candidates.has(urlKey(c.url))) continue
        if (c.score === 'skip') {
          if (c.why !== 'not a page' && c.why !== 'same page') skipped.push({ url: c.url, why: c.why })
          continue
        }
        candidates.set(urlKey(c.url), { ...c, from: d.url })
      }
    }
    let strong = [...candidates.values()].filter((c) => c.score === 'strong')
    let ambiguous = [...candidates.values()].filter((c) => c.score === 'ambiguous' || c.score === 'offsite')
    // Jev ranks every candidate: menus link many pages that name "apply" or "eligibility" for other programmes.
    // A link code calls strong needs less to be followed than one code can't place. Without Jev, unplaced links
    // count against coverage, never silently dropped.
    if (opts.jev && strong.length + ambiguous.length) {
      const scored: { c: Candidate & { from: string }; yes: number }[] = []
      const pool = [...strong, ...ambiguous]
      // Sixty links per request keeps the state small; every candidate is ranked, none dropped.
      for (let at = 0; at < pool.length; at += 60) {
      const all = pool.slice(at, at + 60)
      const questions = Object.fromEntries(
        all.map((c, i) => [
          `l${i}`,
          {
            type: 'noul' as const,
            instructions: {
              question: 'Would following this link most likely open the funder’s rules for this programme: who may apply, what to submit, how applying works, co-funding or grantee duties?',
              link: { words: c.text, url: c.url, surrounding_text: c.context },
            },
            criteria: { true: 'Guidelines, call text, eligibility, FAQ, application instructions or terms for this programme', false: 'News, past grants, another programme, general information or anything else' },
          },
        ]),
      )
      const answers = await opts.jev(p.id, { programme: { name: p.name, funder: p.funder.name, page: p.url } }, questions)
      // A link Jev gave no answer for is followed, never dropped.
      scored.push(...all.map((c, i) => ({ c, yes: (answers[`l${i}`] as { noul?: number })?.noul ?? 1 })))
      }
      const keep = scored.filter((s) => s.yes >= (s.c.score === 'strong' ? LINK_THRESHOLD.strong : LINK_THRESHOLD.ambiguous))
      for (const s of scored) if (!keep.includes(s)) skipped.push({ url: s.c.url, why: `Jev: unlikely to hold this programme's rules (${s.yes.toFixed(2)})` })
      keep.sort((a, b) => b.yes - a.yes)
      strong = keep.map((s) => s.c)
      ambiguous = []
    } else {
      // Without Jev, documents and links into the programme's own section go first: a site menu repeats on every
      // page, and in page order its "Applications" and "Reporting" links spend the crawl bound (Tasmania's NRE).
      const near = (c: Candidate) => (DOC_HREF.test(c.url) || isFileHost(new URL(c.url).hostname) ? Infinity : sharedFolders(new URL(c.url), p.url))
      strong = strong.map((c, i) => ({ c, i, n: near(c) })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.c)
      if (ambiguous.length) {
        reasons.push(`${ambiguous.length} links could not be ranked without Jev`)
        for (const c of ambiguous) skipped.push({ url: c.url, why: 'unranked: no Jev' })
        ambiguous = []
      }
    }
    for (const c of [...strong, ...ambiguous]) {
      if (c.score === 'offsite') {
        failures.push({ url: c.url, from: c.from, kind: 'offsite', message: 'a page on another site about applying: not read, so its rules are unknown' })
        continue
      }
      if (depth > bounds.depth) {
        failures.push({ url: c.url, from: c.from, kind: 'bound', message: `past the crawl depth of ${bounds.depth}` })
        continue
      }
      if (followed >= bounds.documents) {
        failures.push({ url: c.url, from: c.from, kind: 'bound', message: `crawl bound of ${bounds.documents} documents reached` })
        continue
      }
      if (seen.has(urlKey(c.url))) continue
      followed++
      const d = await open(c.url, c.from, c.text, depth)
      if (d && !d.pdf) next.push(d)
    }
    frontier = next
  }

  // A followed document must be about this programme by its own text, not just its link. Naming the funder is not
  // enough: every page of its site does, its other programmes' included, and a third party's guide names it too.
  // Only the programme's own name lets a first-party document skip Jev; one on another host always needs Jev's yes.
  const names = programmeNames(p)
  const firstParty = new Set(seedsOf(p).map((u) => URL.parse(u)?.hostname).filter((h): h is string => !!h).map(site))
  for (const d of [...docs]) {
    if (d.depth === 0 || d.low_text) continue
    // By the link the funder published: its own file on a file host, linked directly or through a redirect
    // (Wix serves site files from filesusr.com), is still first-party.
    const offsite = !firstParty.has(site(new URL(d.url).hostname)) && !isFileHost(new URL(d.url).hostname)
    const head = comparable(d.text.slice(0, 20_000))
    if (!offsite && names.some((n) => head.includes(n))) continue
    let about = offsite ? 0 : 0.5
    if (opts.jev) {
      const a = await opts.jev(p.id, { programme: { name: p.name, funder: p.funder.name, rounds: p.calls.map((c) => c.label) }, document: { url: d.url, linked_as: d.anchor, opening: d.text.slice(0, 6000) } }, {
        about: { type: 'noul', instructions: 'Is this document about this funding programme (its guidelines, call, application or terms), rather than another programme, a report or general information?' },
      })
      about = (a.about as { noul?: number })?.noul ?? (offsite ? 0 : 0.5)
    }
    if (about < 0.5) {
      docs.splice(docs.indexOf(d), 1)
      if (offsite && !opts.jev) failures.push({ url: d.url, from: d.from, kind: 'offsite', message: 'a document on another site: without Jev it can’t be confirmed as the funder’s, so it is not used' })
      else failures.push({ url: d.url, from: d.from, kind: 'off_topic', message: `not about this programme (${about.toFixed(2)})` })
    }
  }
  docs.forEach((d, i) => (d.ref = `D${i + 1}`))

  for (const f of failures) {
    if (f.kind === 'off_topic') continue
    if (f.kind === 'bound') reasons.push(`the crawl bound left ${f.url} unread`)
    else if (f.kind === 'low_text' || f.kind === 'offsite') reasons.push(`${f.url}: ${f.message}`)
    else reasons.push(`${f.url} would not open (${f.kind}: ${f.message})`)
  }
  if (!docs.length) reasons.push('no page opened')
  return { docs, failures, skipped, complete: reasons.length === 0, reasons: [...new Set(reasons)] }
}
