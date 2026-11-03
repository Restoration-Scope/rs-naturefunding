// The digest Worker's behaviour, separate from its entry (worker.ts) so tests run it against an in-memory D1 and a
// fake Resend. Sign-up is a plain HTML form post (the site ships no JS for it); every answer is a redirect back to
// a static page on the site, except the two confirm-by-button pages, which this Worker renders.
import type { Programme } from '../../src/data/schema'
import { isConsentVersion, type ConsentVersion } from './consent'
import { buildDigest } from './digest'
import { confirmationEmail, digestEmail } from './email'
import type { DigestEvent } from './events'
import { cleanPrefs, prefsText, type Approach, type Prefs } from './match'
import { resendMailer, SendFailed, type Mailer, type Outgoing } from './resend'
import { addressHash, CONFIRM_TTL_MS, open, seal } from './token'

/** The slice of D1 this Worker uses. */
export type D1 = {
  prepare(sql: string): D1Statement
}
export type D1Statement = {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}
export type RateLimit = { limit(o: { key: string }): Promise<{ success: boolean }> }

export type Env = {
  DB: D1
  SIGNUP_LIMIT?: RateLimit
  LIST_SECRET: string
  RESEND_API_KEY: string
  /** naturefunding.org, where the static pages are. */
  SITE_URL: string
  /** This Worker's own origin, for links in emails. */
  SELF_URL: string
  EMAIL_FROM: string
  /** 'live' sends digests; anything else only counts them (the default until Bernat's OK for the first send). */
  DIGEST_SENDING?: string
  /** When set, every email goes to this address instead (Resend's delivered@resend.dev in local runs). */
  TEST_RECIPIENT?: string
  RESEND_BASE_URL?: string
  DAILY_DIGEST_LIMIT?: string
  DAILY_CONFIRM_LIMIT?: string
}

export type Deps = {
  programmes: Map<string, Programme>
  events: DigestEvent[]
  /** When the newest commit in the bundle reached main (scripts/history.ts coveredUntil); defaults to now. */
  coveredUntil?: string
  mailer?: Mailer
  now?: () => Date
  /** Pause between digest sends; tests set 0. */
  sendGapMs?: number
}

type Ctx = { waitUntil(p: Promise<unknown>): void }

const DAY = 86_400_000
const WEEK = 7 * DAY
/** Resend's free plan takes 2 requests a second. */
const SEND_GAP_MS = 600
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/

const mailerFor = (env: Env, deps: Deps) =>
  deps.mailer ??
  resendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, baseUrl: env.RESEND_BASE_URL, testRecipient: env.TEST_RECIPIENT })

const redirect = (to: string) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store' } })
const page = (env: Env, path: string) => redirect(`${env.SITE_URL}${path}`)

export async function handle(request: Request, env: Env, deps: Deps, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url)
  const now = deps.now?.() ?? new Date()
  try {
    if (url.pathname === '/subscribe' && request.method === 'POST') return await subscribe(request, env, deps, ctx, now)
    if (url.pathname === '/confirm') return await confirm(request, url, env, now)
    if (url.pathname === '/unsubscribe') return await unsubscribe(request, url, env)
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/subscribe')) return page(env, '/digest/')
    return new Response('Not found', { status: 404 })
  } catch (e) {
    console.error('digest request failed', url.pathname, e instanceof Error ? e.message : e)
    return page(env, '/digest/error/')
  }
}

// ---------- Sign-up ----------

async function subscribe(request: Request, env: Env, deps: Deps, ctx: Ctx, now: Date) {
  const form = await request.formData().catch(() => null)
  const done = page(env, '/digest/check-your-inbox/')
  if (!form) return page(env, '/digest/')
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) return page(env, '/digest/check-address/')
  const consent = form.get('consent')
  // Bots fill the hidden field; they get the same answer as everyone else.
  if (form.getAll('nf_hp').some((v) => v !== '') || !isConsentVersion(consent)) return done
  const prefs = cleanPrefs(form.get('where'), form.getAll('approach'))
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  // The answer never says whether this address asked before or hit a limit; the work runs after it.
  ctx.waitUntil(admit(env, deps, email, prefs, consent, ip, now).catch((e) => console.error('admit failed', e instanceof Error ? e.message : e)))
  return done
}

/** Sends a confirmation email unless a limit says no: per IP, per address (1 an hour, 3 a day), and per day overall. */
async function admit(env: Env, deps: Deps, email: string, prefs: Prefs, consent: ConsentVersion, ip: string, now: Date) {
  if (env.SIGNUP_LIMIT && !(await env.SIGNUP_LIMIT.limit({ key: ip })).success) return
  const hash = await addressHash(email, env.LIST_SECRET)
  // One statement checks every limit and records the attempt, so two requests at once can't both pass.
  const admitted = await env.DB.prepare(
    `INSERT INTO attempts (hash, at) SELECT ?1, ?2
     WHERE (SELECT COUNT(*) FROM attempts WHERE hash = ?1 AND at > ?3) = 0
       AND (SELECT COUNT(*) FROM attempts WHERE hash = ?1 AND at > ?4) < 3
       AND (SELECT COUNT(*) FROM attempts WHERE at > ?4) < ?5
     RETURNING hash`,
  )
    .bind(hash, now.toISOString(), new Date(now.getTime() - 3_600_000).toISOString(), new Date(now.getTime() - DAY).toISOString(), Number(env.DAILY_CONFIRM_LIMIT ?? 20))
    .first()
  if (!admitted) return
  const token = await seal({ k: 'confirm', email, where: prefs.where, approaches: prefs.approaches, consent, at: now.getTime() }, env.LIST_SECRET)
  const msg = confirmationEmail({ site: env.SITE_URL, confirmUrl: `${env.SELF_URL}/confirm?t=${token}`, prefs })
  try {
    await mailerFor(env, deps).send({ to: email, ...msg })
  } catch (e) {
    // Nothing went out, or may not have: give the attempt back so trying again in a minute works.
    await env.DB.prepare('DELETE FROM attempts WHERE hash = ?1 AND at = ?2').bind(hash, now.toISOString()).run()
    throw e
  }
}

// ---------- Confirm: the link opens a page; only its button subscribes, so link scanners can't ----------

async function confirm(request: Request, url: URL, env: Env, now: Date) {
  const token = request.method === 'POST' ? String((await request.formData()).get('t') ?? '') : (url.searchParams.get('t') ?? '')
  const claim = await open(token, env.LIST_SECRET)
  if (!claim || claim.k !== 'confirm' || !isConsentVersion(claim.consent) || now.getTime() - claim.at > CONFIRM_TTL_MS) return page(env, '/digest/link-expired/')
  const prefs: Prefs = { where: claim.where, approaches: claim.approaches as Approach[] }
  if (request.method !== 'POST') {
    const what = prefsText(prefs)
    return buttonPage({
      title: 'Confirm your email',
      lead: `Start getting new nature funding calls at ${claim.email}${what ? ` for ${what}` : ''}: at most one email a week, only when something is new.`,
      action: '/confirm',
      token,
      label: 'Confirm my email',
      site: env.SITE_URL,
    })
  }
  await env.DB.prepare(
    `INSERT INTO subscribers (id, email, where_code, approaches, consent, chosen_at, confirmed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (email) DO UPDATE SET where_code = excluded.where_code, approaches = excluded.approaches, consent = excluded.consent,
       chosen_at = excluded.chosen_at
     WHERE excluded.chosen_at > subscribers.chosen_at`,
  )
    .bind(crypto.randomUUID(), claim.email, prefs.where, prefs.approaches.join(' '), claim.consent, new Date(claim.at).toISOString(), now.toISOString())
    .run()
  return page(env, '/digest/subscribed/')
}

// ---------- Unsubscribe: mail apps post one-click (RFC 8058); the link in the email opens a one-button page ----------

async function unsubscribe(request: Request, url: URL, env: Env) {
  const form = request.method === 'POST' ? await request.formData().catch(() => null) : null
  const token = url.searchParams.get('t') ?? String(form?.get('t') ?? '')
  const claim = await open(token, env.LIST_SECRET)
  const oneClick = form?.get('List-Unsubscribe') === 'One-Click'
  if (!claim || claim.k !== 'unsubscribe') return oneClick ? new Response('Unknown link', { status: 400 }) : page(env, '/digest/link-expired/')
  if (request.method !== 'POST') {
    return buttonPage({
      title: 'Unsubscribe',
      lead: 'Stop the weekly naturefunding.org email. We delete your address; nothing else is kept.',
      action: '/unsubscribe',
      token,
      label: 'Unsubscribe',
      site: env.SITE_URL,
    })
  }
  await env.DB.prepare('DELETE FROM subscribers WHERE id = ?1').bind(claim.id).run()
  return oneClick ? new Response('Unsubscribed', { status: 200 }) : page(env, '/digest/unsubscribed/')
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

function buttonPage(o: { title: string; lead: string; action: string; token: string; label: string; site: string }) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(o.title)} · naturefunding.org</title>
<link rel="icon" type="image/svg+xml" href="${esc(o.site)}/favicon.svg">
<style>
@font-face{font-family:Inter;src:url(${esc(o.site)}/fonts/inter-latin-variable.woff2) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Geist Serif';src:url(${esc(o.site)}/fonts/geist-serif-regular.woff2) format('woff2');font-display:swap}
:root{--paper:#f7f4ef;--linen:#edeae7;--ink:#1b2722;--ink-2:#565e5b;--brand:#3a7e49;--shell:#254b36;--shell-2:#beccc2}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}
header{background:var(--shell);color:var(--paper)}header a{color:inherit;text-decoration:none;font:400 22px 'Geist Serif',Georgia,serif}header span{color:var(--shell-2)}
.wrap{max-width:44rem;margin:0 auto;padding:14px 16px}main .wrap{padding-top:40px}
h1{font:400 clamp(1.75rem,1.2rem + 2.2vw,2.5rem)/1.15 'Geist Serif',Georgia,serif;margin:0 0 12px}p{margin:0 0 24px;max-width:60ch}
button{font:600 16px Inter,ui-sans-serif,system-ui,sans-serif;background:var(--brand);color:#fff;border:0;border-radius:6px;padding:12px 22px;min-height:44px;cursor:pointer}
button:focus-visible{outline:3px solid var(--shell);outline-offset:2px}
</style></head>
<body><header><div class="wrap"><a href="${esc(o.site)}/">naturefunding<span>.org</span></a></div></header>
<main><div class="wrap"><h1>${esc(o.title)}</h1><p>${esc(o.lead)}</p>
<form method="post" action="${esc(o.action)}"><input type="hidden" name="t" value="${esc(o.token)}"><button type="submit">${esc(o.label)}</button></form>
</div></main></body></html>`
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' },
  })
}

// ---------- The daily run: each subscriber gets at most one digest per 7 days ----------

type Row = { id: string; email: string; where_code: string; approaches: string; confirmed_at: string; last_sent_at: string | null; sent_through: string | null }

export type RunReport = { due: number; withNews: number; sent: number; mode: 'live' | 'count-only' }

/**
 * Sends digests to subscribers whose last one was 7+ days ago (oldest first), up to the daily limit counted across
 * the whole UTC day, which keeps the send inside the email provider's allowance and spreads a large list across the
 * week. A subscriber with nothing new is skipped and tried again tomorrow.
 *
 * The day's sends are claimed in the database before any goes out, and a claim is undone only when Resend certainly
 * sent nothing. A failure that may have sent (a timeout, a 5xx) keeps the claim: a subscriber may miss one digest, but
 * never gets two.
 */
export async function runDigest(env: Env, deps: Deps): Promise<RunReport> {
  const now = deps.now?.() ?? new Date()
  const nowIso = now.toISOString()
  const live = env.DIGEST_SENDING === 'live'
  const through = deps.coveredUntil && deps.coveredUntil < nowIso ? deps.coveredUntil : nowIso
  await env.DB.prepare('DELETE FROM attempts WHERE at < ?1').bind(new Date(now.getTime() - 2 * DAY).toISOString()).run()
  const weekAgo = new Date(now.getTime() - WEEK).toISOString()
  const due = (
    await env.DB.prepare(
      `SELECT id, email, where_code, approaches, confirmed_at, last_sent_at, sent_through FROM subscribers
       WHERE last_sent_at IS NULL OR last_sent_at <= ?1 ORDER BY COALESCE(last_sent_at, confirmed_at)`,
    )
      .bind(weekAgo)
      .all<Row>()
  ).results
  const sentToday = await env.DB.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE last_sent_at >= ?1')
    .bind(`${nowIso.slice(0, 10)}T00:00:00.000Z`)
    .first<{ n: number }>()
  const limit = Math.max(0, Number(env.DAILY_DIGEST_LIMIT ?? 75) - (sentToday?.n ?? 0))

  const outgoing: { row: Row; email: Outgoing }[] = []
  let withNews = 0
  for (const s of due) {
    const prefs = cleanPrefs(s.where_code, s.approaches ? s.approaches.split(' ') : [])
    const since = s.sent_through ?? s.confirmed_at
    const digest = buildDigest(deps.events, deps.programmes, prefs, since, nowIso)
    if (digest.items.length === 0) continue
    withNews++
    if (outgoing.length >= limit) continue
    const unsubscribeUrl = `${env.SELF_URL}/unsubscribe?t=${await seal({ k: 'unsubscribe', id: s.id }, env.LIST_SECRET)}`
    const msg = digestEmail({ site: env.SITE_URL, digest, prefs, since, unsubscribeUrl, manageUrl: `${env.SITE_URL}/digest/` })
    outgoing.push({
      row: s,
      email: {
        to: s.email,
        ...msg,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      },
    })
  }

  let sent = 0
  if (live && outgoing.length > 0) {
    const mailer = mailerFor(env, deps)
    // Claim: only rows still due are taken, so a second run (or one running at the same time) skips them.
    const claimed = new Set(
      (
        await env.DB.prepare(
          `UPDATE subscribers SET last_sent_at = ?1, sent_through = ?2
           WHERE id IN (SELECT value FROM json_each(?3)) AND (last_sent_at IS NULL OR last_sent_at <= ?4) RETURNING id`,
        )
          .bind(nowIso, through, JSON.stringify(outgoing.map((o) => o.row.id)), weekAgo)
          .all<{ id: string }>()
      ).results.map((r) => r.id),
    )
    const mine = outgoing.filter((o) => claimed.has(o.row.id))
    const undo = (rows: Row[]) =>
      env.DB.prepare(
        `UPDATE subscribers SET last_sent_at = json_extract(j.value, '$[1]'), sent_through = json_extract(j.value, '$[2]')
         FROM json_each(?1) AS j WHERE subscribers.id = json_extract(j.value, '$[0]') AND subscribers.last_sent_at = ?2`,
      )
        .bind(JSON.stringify(rows.map((r) => [r.id, r.last_sent_at, r.sent_through])), nowIso)
        .run()
    // One request per subscriber, so one refused address can't hold back the others.
    for (const [n, o] of mine.entries()) {
      if (n > 0) await sleep(deps.sendGapMs ?? SEND_GAP_MS)
      try {
        await mailer.send(o.email, `digest/${nowIso.slice(0, 10)}/${o.row.id}`)
        sent++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!(e instanceof SendFailed && e.accepted === false)) {
          console.error('digest may have gone out; kept as sent', msg)
          sent++
        } else if (e.status === 429) {
          // Over the provider's limit: give this one and the rest back for tomorrow.
          await undo(mine.slice(n).map((x) => x.row))
          console.error('digest run stopped at the provider limit', msg)
          break
        } else {
          // Refused (a bad address, say): tried again tomorrow; the others still go.
          await undo([o.row])
          console.error('digest refused', msg)
        }
      }
    }
  }
  const report: RunReport = { due: due.length, withNews, sent, mode: live ? 'live' : 'count-only' }
  console.log('digest run', JSON.stringify(report))
  return report
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
