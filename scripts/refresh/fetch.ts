/**
 * Reads funder pages politely: an honest user agent, robots.txt, a timeout, and a gap
 * between requests to the same host. Pages turn into the same text the seeding and
 * quote checks use (scripts/data/page-text.ts); only its hash is kept.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { htmlToText, normalise } from '../data/page-text'

export const USER_AGENT = 'Mozilla/5.0 (compatible; naturefunding-refresh/1.0; +https://naturefunding.org/about/)'
const ROBOTS_TOKEN = 'naturefunding-refresh'
const TIMEOUT_MS = 30_000
export const HOST_GAP_MS = 4_000
const PARALLEL_HOSTS = 4

export type FailureKind = 'blocked' | 'robots' | 'http' | 'timeout' | 'network' | 'selector' | 'unreadable'

export type Fetched =
  /** `finalUrl` is where redirects ended. */
  | { ok: true; url: string; finalUrl: string; status: number; pdf: boolean; text: string; hash: string }
  | { ok: false; url: string; kind: FailureKind; message: string }

export const hashText = (text: string) => `sha256:${createHash('sha256').update(normalise(text)).digest('hex')}`

const CHALLENGE = /<title>\s*(just a moment\.\.\.|attention required! \| cloudflare|access denied|are you a robot)|enable javascript and cookies to continue|cf-chl-|incapsula incident id|_incapsula_resource|request unsuccessful\. incapsula/i

/** A failed response or a bot-challenge page, or null when the page can be read. */
export function classifyResponse(status: number, body: string): { kind: FailureKind; message: string } | null {
  const challenge = body.length < 30_000 && CHALLENGE.test(body)
  if ([401, 403, 429, 451].includes(status)) return { kind: 'blocked', message: `HTTP ${status}` }
  if (status === 503 && challenge) return { kind: 'blocked', message: 'HTTP 503 bot challenge' }
  if (status >= 400) return { kind: 'http', message: `HTTP ${status}` }
  if (challenge) return { kind: 'blocked', message: `HTTP ${status} bot challenge page` }
  return null
}

/** Whether robots.txt lets us read a path: our own group if present, else `*`. Longest match wins; Allow wins ties. */
export function robotsAllows(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; prefix: string }[] }[] = []
  let current: (typeof groups)[number] | null = null
  let lastWasAgent = false
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const field = m[1].toLowerCase()
    const value = m[2].trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }))
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if ((field === 'allow' || field === 'disallow') && current) {
      if (value) current.rules.push({ allow: field === 'allow', prefix: value.replace(/\*$/, '') })
      lastWasAgent = false
    } else {
      lastWasAgent = false
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== '*' && ROBOTS_TOKEN.startsWith(a)))
  const rules = (ours.length ? ours : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules)
  let best: { allow: boolean; prefix: string } | null = null
  for (const r of rules) {
    if (!path.startsWith(r.prefix)) continue
    if (!best || r.prefix.length > best.prefix.length || (r.prefix.length === best.prefix.length && r.allow)) best = r
  }
  return best?.allow ?? true
}

function pdfToText(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'nf-pdf-'))
  try {
    const file = join(dir, 'page.pdf')
    writeFileSync(file, bytes)
    const run = Bun.spawnSync(['pdftotext', '-enc', 'UTF-8', file, '-'])
    if (run.exitCode !== 0) throw new Error(`pdftotext failed: ${run.stderr.toString().trim()}`)
    return normalise(run.stdout.toString())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const get = (url: string) =>
  fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'accept-language': 'en' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

const robotsCache = new Map<string, Promise<string>>()
function robotsFor(origin: string): Promise<string> {
  let p = robotsCache.get(origin)
  if (!p) {
    p = get(`${origin}/robots.txt`)
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => '')
    robotsCache.set(origin, p)
  }
  return p
}

export async function readPage(url: string, selector: string | null): Promise<Fetched> {
  const u = new URL(url)
  if (!robotsAllows(await robotsFor(u.origin), u.pathname + u.search)) {
    return { ok: false, url, kind: 'robots', message: 'robots.txt disallows this page' }
  }
  let res: Response
  let bytes: Uint8Array
  try {
    res = await get(url)
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    const err = e as Error
    const timeout = err.name === 'TimeoutError' || err.name === 'AbortError'
    return { ok: false, url, kind: timeout ? 'timeout' : 'network', message: timeout ? `no answer in ${TIMEOUT_MS / 1000}s` : err.message }
  }
  const pdf = (res.headers.get('content-type') ?? '').includes('pdf') || new TextDecoder().decode(bytes.subarray(0, 4)) === '%PDF'
  const body = pdf ? '' : new TextDecoder().decode(bytes)
  const failure = classifyResponse(res.status, body)
  if (failure) return { ok: false, url, ...failure }
  try {
    const text = pdf ? pdfToText(bytes) : await htmlToText(body, selector)
    if (text.length < 40) return { ok: false, url, kind: 'unreadable', message: `only ${text.length} characters of text` }
    return { ok: true, url, finalUrl: res.url || url, status: res.status, pdf, text, hash: hashText(text) }
  } catch (e) {
    const message = (e as Error).message
    return { ok: false, url, kind: message.includes('selector') ? 'selector' : 'unreadable', message }
  }
}

/** Reads every page, a few hosts at once, one request at a time per host with a gap between. */
export async function readPages<T extends { url: string; selector: string | null }>(
  items: T[],
  read: (url: string, selector: string | null) => Promise<Fetched> = readPage,
  gapMs = HOST_GAP_MS,
): Promise<Map<T, Fetched>> {
  const byHost = new Map<string, T[]>()
  for (const item of items) {
    const host = new URL(item.url).host
    byHost.set(host, [...(byHost.get(host) ?? []), item])
  }
  const queues = [...byHost.values()]
  const results = new Map<T, Fetched>()
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_HOSTS, queues.length) }, async () => {
      for (let queue = queues.shift(); queue; queue = queues.shift()) {
        for (const [i, item] of queue.entries()) {
          if (i > 0) await Bun.sleep(gapMs)
          results.set(item, await read(item.url, item.selector))
        }
      }
    }),
  )
  return results
}
