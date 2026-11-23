/**
 * Browser reads: funder pages our fetcher can't open (a bot filter, a challenge page, robots.txt) read once in
 * a browser and kept on disk, so the gather reads them like any other page. Bernat approved reading the
 * blocked pages this way (2026-11-23); a challenge that asks for a human (a CAPTCHA) stays unread.
 *
 *   bun scripts/requirements/browser-reads.ts queue <run folder or reading…>   blocked and robots URLs not read yet, one per line
 *   bun scripts/requirements/browser-reads.ts serve <run folder or reading…>   hand the queue to a browser and save what it posts
 *
 *   bun scripts/requirements/browser-reads.ts snippet               the script to run on each page
 *   bun scripts/requirements/browser-reads.ts text <url>            a stored copy as text, for a reviewer the page refuses
 *
 * A browser agent opens /next, runs the snippet on each page it is sent to, and opens /skip on a page that
 * won't load or asks for a human (a CAPTCHA stays unsolved). A page whose security policy blocks the post (the
 * browser stays on it) is read as text and posted from the shell: curl -F b64=@<base64 file> '…/save?at=<url>'.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyResponse } from '../refresh/fetch'
import { urlKey, type Reader } from './gather'

export const BROWSER_DIR = join(process.cwd(), '.cache', 'requirements', 'browser')
/** What a browser can open that our fetcher can't. */
const BROWSER_KINDS = new Set(['blocked', 'robots'])

const keyOf = (url: string) => createHash('sha256').update(urlKey(url)).digest('hex').slice(0, 24)

export function saveBrowserRead(dir: string, url: string, bytes: Uint8Array): void {
  mkdirSync(dir, { recursive: true })
  const head = new TextDecoder().decode(bytes.slice(0, 5))
  writeFileSync(join(dir, `${keyOf(url)}.bin`), bytes)
  writeFileSync(join(dir, `${keyOf(url)}.json`), JSON.stringify({ url, pdf: head === '%PDF-', read_at: new Date().toISOString().slice(0, 10) }))
}

const skipFile = (dir: string) => join(dir, 'skipped.txt')
const skipped = (dir: string) => new Set(existsSync(skipFile(dir)) ? readFileSync(skipFile(dir), 'utf8').split('\n').filter(Boolean) : [])

export function hasBrowserRead(dir: string, url: string): boolean {
  return existsSync(join(dir, `${keyOf(url)}.json`))
}

/** The stored browser copy of a page, if there is one. */
export function browserRead(url: string, dir = BROWSER_DIR): { pdf: boolean; bytes: Uint8Array } | null {
  if (!hasBrowserRead(dir, url)) return null
  const m = JSON.parse(readFileSync(join(dir, `${keyOf(url)}.json`), 'utf8')) as { pdf: boolean }
  return { pdf: m.pdf, bytes: new Uint8Array(readFileSync(join(dir, `${keyOf(url)}.bin`))) }
}

/** The reader, falling back to a browser read for a page the fetcher was refused. */
export function withBrowserReads(read: Reader, dir = BROWSER_DIR): Reader {
  return async (url) => {
    const r = await read(url)
    const copy = r.ok || !BROWSER_KINDS.has(r.kind) ? null : browserRead(url, dir)
    if (!copy) return r
    return { ok: true, finalUrl: url, pdf: copy.pdf, html: copy.pdf ? '' : new TextDecoder().decode(copy.bytes), bytes: copy.bytes }
  }
}

/**
 * Blocked and robots URLs not read yet, from a gather run folder (its docs/<id>/gathered.json), a requirements
 * reading (data/requirements/<id>.json), or a folder of readings: a full run keeps only the readings.
 */
export function browserQueue(from: string, dir = BROWSER_DIR): string[] {
  const docs = join(from, 'docs')
  const files = from.endsWith('.json')
    ? [from]
    : existsSync(docs)
      ? readdirSync(docs).map((id) => join(docs, id, 'gathered.json'))
      : readdirSync(from).filter((f) => f.endsWith('.json')).map((f) => join(from, f))
  const urls = new Set<string>()
  const skip = skipped(dir)
  for (const f of files) {
    if (!existsSync(f)) continue
    const g = JSON.parse(readFileSync(f, 'utf8')) as { failures?: { url: string; kind: string }[] }
    for (const x of g.failures ?? []) if (BROWSER_KINDS.has(x.kind) && !hasBrowserRead(dir, x.url) && !skip.has(x.url)) urls.add(x.url)
  }
  return [...urls].sort()
}

/**
 * A challenge page the browser was shown is not the funder's page. A page that passed one still carries the
 * filter's script, so only a challenge with little text of its own counts.
 */
export function isChallenge(bytes: Uint8Array): boolean {
  if (new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return false
  const html = new TextDecoder().decode(bytes.slice(0, 30_000))
  if (/<title>\s*(just a moment|attention required|access denied|are you a robot|security check|verify)/i.test(html)) return true
  const chars = html.replace(/<(script|style)[\s\S]*?<\/\1>|<[^>]+>/gi, ' ').replace(/\s+/g, ' ').length
  return classifyResponse(200, html) !== null && bytes.length < 30_000 && chars < 1000
}

/**
 * The page script, the same on every page: it posts what the browser shows (a PDF's bytes) to `serve`, which saves
 * it under the URL it sent the browser to and redirects to the next one. A form post, since a page's fetch to
 * localhost is blocked and a top-level navigation is not. On the receiver's own pages it posts nothing.
 */
export const SNIPPET = `if (location.port === "8787") document.body.innerText.slice(0, 200); else { const b = document.contentType === "application/pdf" ? new Uint8Array(await (await fetch(location.href)).arrayBuffer()) : new TextEncoder().encode("<!doctype html>" + document.documentElement.outerHTML); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); const f = document.createElement("form"); f.method = "POST"; f.enctype = "multipart/form-data"; f.action = "http://127.0.0.1:8787/save?at=" + encodeURIComponent(location.href); const t = document.createElement("textarea"); t.name = "b64"; t.value = btoa(s); f.append(t); document.documentElement.append(f); f.submit(); document.title + " " + b.length }`

/**
 * The receiver. Open http://127.0.0.1:8787/next in the browser: it redirects to the first queued URL. Run SNIPPET
 * there; the save redirects to the next. A challenge page, or a page the browser never left (a file it downloaded),
 * is skipped the same way; /skip passes over a URL the browser can't open.
 */
export function serve(queue: string[], port = 8787, dir = BROWSER_DIR) {
  const todo = queue.filter((u) => !hasBrowserRead(dir, u))
  let current: string | null = null
  let lastAt: string | null = null
  const next = () => {
    current = todo.shift() ?? null
    return current ? Response.redirect(current, 302) : new Response(`DONE: queue empty`)
  }
  const skip = () => {
    if (current) appendFileSync(skipFile(dir), `${current}\n`)
    return next()
  }
  Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req) {
      const path = new URL(req.url).pathname
      if (path === '/next') return next()
      if (path === '/skip') {
        console.log(`skipped ${current}`)
        return skip()
      }
      if (path !== '/save' || req.method !== 'POST' || !current) return new Response('open /next', { status: 400 })
      // A page the browser could not show (a file it downloads) leaves it on the last page: never save that twice.
      const at = new URL(req.url).searchParams.get('at')
      if (at && at === lastAt) {
        console.log(`skipped ${current}: the browser stayed on ${at}`)
        return skip()
      }
      const form = await req.formData()
      const bytes = new Uint8Array(Buffer.from(String(form.get('b64')), 'base64'))
      if (isChallenge(bytes)) {
        console.log(`skipped ${current}: a challenge page`)
        return skip()
      }
      lastAt = at
      saveBrowserRead(dir, current, bytes)
      console.log(`saved ${bytes.length} bytes ${current}`)
      return next()
    },
  })
  console.log(`${todo.length} URLs queued; open http://127.0.0.1:${port}/next`)
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd === 'queue' && args.length) console.log([...new Set(args.flatMap((a) => browserQueue(a)))].sort().join('\n'))
  else if (cmd === 'serve' && args.length) serve([...new Set(args.flatMap((a) => browserQueue(a)))].sort())
  else if (cmd === 'snippet') console.log(SNIPPET)
  else if (cmd === 'text' && args[0]) {
    const copy = browserRead(args[0])
    if (!copy) throw new Error(`no browser copy of ${args[0]}`)
    const { htmlToText } = await import('../data/page-text')
    const { readPdf } = await import('../data/pdf')
    console.log(copy.pdf ? readPdf(copy.bytes).pages.join('\n') : await htmlToText(new TextDecoder().decode(copy.bytes)))
  } else throw new Error('usage: browser-reads.ts queue <run folder or reading…> | serve <run folder or reading…> | snippet | text <url>')
}
