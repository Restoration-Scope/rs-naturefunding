// The Worker end to end, in process: form post → confirmation email → confirm page → button → stored subscriber
// → daily run → digest with one-click unsubscribe → unsubscribe. D1 is bun:sqlite with schema.sql.
import { beforeEach, describe, expect, test } from 'bun:test'
import { loadProgrammes } from '../../src/data/load'
import { handle, runDigest, type Deps, type Env } from './app'
import type { DigestEvent } from './events'
import { SendFailed } from './resend'
import { memoryD1, recordingMailer } from './test-support'

const programmes = new Map(loadProgrammes().map((p) => [p.id, p]))
const today = '2026-11-02'
const openProgramme = [...programmes.values()].find((p) => p.calls.some((c) => c.status === 'open' && !(c.deadline && c.deadline.date < '2026-11-20')))!
const openCall = openProgramme.calls.find((c) => c.status === 'open' && !(c.deadline && c.deadline.date < '2026-11-20'))!

let clock = new Date(`${today}T10:00:00Z`)
let db: ReturnType<typeof memoryD1>
let mailer: ReturnType<typeof recordingMailer>
let events: DigestEvent[]
let pending: Promise<unknown>[]
const env = (): Env => ({
  DB: db,
  LIST_SECRET: 'test-secret',
  RESEND_API_KEY: 'unused',
  SITE_URL: 'https://naturefunding.org',
  SELF_URL: 'https://email.naturefunding.org',
  EMAIL_FROM: 'naturefunding.org <updates@naturefunding.org>',
  DIGEST_SENDING: 'live',
})
const deps = (): Deps => ({ programmes, events, mailer, now: () => clock, sendGapMs: 0 })
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) }
const call = async (req: Request, e = env()) => {
  const res = await handle(req, e, deps(), ctx)
  await Promise.all(pending)
  return res
}
const form = (path: string, fields: [string, string][], query = '') =>
  new Request(`https://email.naturefunding.org${path}${query}`, { method: 'POST', body: new URLSearchParams(fields), headers: { 'CF-Connecting-IP': '203.0.113.9' } })
const signup = (email: string, extra: [string, string][] = []) => call(form('/subscribe', [['email', email], ['consent', 'v1'], ['nf_hp', ''], ...extra]))
const linkIn = (html: string, path: string) => html.match(new RegExp(`https://email\\.naturefunding\\.org${path}\\?t=[A-Za-z0-9_-]+`))![0]
const subscribers = () => db.sqlite.query('SELECT * FROM subscribers').all() as Record<string, string | null>[]

beforeEach(() => {
  clock = new Date(`${today}T10:00:00Z`)
  db = memoryD1()
  mailer = recordingMailer()
  events = []
  pending = []
})

async function subscribeAndConfirm(email: string, extra: [string, string][] = []) {
  await signup(email, extra)
  const link = linkIn(mailer.sent.at(-1)!.html, '/confirm')
  const token = new URL(link).searchParams.get('t')!
  await call(form('/confirm', [['t', token]]))
}

describe('sign-up with double opt-in', () => {
  test('the form answers at once, and only the confirm button stores the address', async () => {
    const res = await signup('Ana@Example.org', [['where', 'KE'], ['approach', 'mangroves'], ['approach', 'nonsense']])
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('https://naturefunding.org/digest/check-your-inbox/')
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]!.to).toBe('ana@example.org')
    expect(mailer.sent[0]!.text).toContain('for Kenya · Mangroves')
    expect(subscribers()).toHaveLength(0)

    // Opening the link (or a mail scanner fetching it) shows a page and stores nothing.
    const link = linkIn(mailer.sent[0]!.html, '/confirm')
    const page = await call(new Request(link))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Confirm my email')
    expect(subscribers()).toHaveLength(0)

    const done = await call(form('/confirm', [['t', new URL(link).searchParams.get('t')!]]))
    expect(done.headers.get('Location')).toBe('https://naturefunding.org/digest/subscribed/')
    expect(subscribers()).toMatchObject([{ email: 'ana@example.org', where_code: 'KE', approaches: 'mangroves', consent: 'v1', last_sent_at: null }])
  })

  test('confirming again updates the saved filters instead of adding a row', async () => {
    await subscribeAndConfirm('ana@example.org', [['where', 'KE']])
    clock = new Date(clock.getTime() + 2 * 3_600_000)
    await subscribeAndConfirm('ana@example.org', [['where', 'r:asia']])
    expect(subscribers()).toMatchObject([{ email: 'ana@example.org', where_code: 'r:asia' }])
  })

  test('a bad address goes back to the form; a filled honeypot or unknown consent sends nothing', async () => {
    expect((await signup('not-an-email')).headers.get('Location')).toBe('https://naturefunding.org/digest/check-address/')
    expect((await signup('bot@example.org', [['nf_hp', 'http://spam']])).headers.get('Location')).toBe('https://naturefunding.org/digest/check-your-inbox/')
    await call(form('/subscribe', [['email', 'x@example.org'], ['consent', 'v0']]))
    await call(form('/subscribe', [['email', 'x@example.org'], ['consent', 'toString']]))
    expect(mailer.sent).toHaveLength(0)
  })

  test('one confirmation email an hour per address, and the answer never says so', async () => {
    await signup('ana@example.org')
    const again = await signup('ana@example.org')
    expect(again.headers.get('Location')).toBe('https://naturefunding.org/digest/check-your-inbox/')
    expect(mailer.sent).toHaveLength(1)
    clock = new Date(clock.getTime() + 61 * 60_000)
    await signup('ana@example.org')
    expect(mailer.sent).toHaveLength(2)
  })

  test('two sign-ups for one address at the same moment send one email', async () => {
    await Promise.all([handle(form('/subscribe', [['email', 'ana@example.org'], ['consent', 'v1']]), env(), deps(), ctx), handle(form('/subscribe', [['email', 'ana@example.org'], ['consent', 'v1']]), env(), deps(), ctx)])
    await Promise.all(pending)
    expect(mailer.sent).toHaveLength(1)
  })

  test('a confirmation email that failed to send doesn\u2019t use up the hour', async () => {
    const send = mailer.send
    mailer.send = async () => {
      throw new SendFailed('Resend /emails 500', null, 500)
    }
    await signup('ana@example.org')
    mailer.send = send
    await signup('ana@example.org')
    expect(mailer.sent).toHaveLength(1)
  })

  test('an older confirm link doesn\u2019t put back older choices', async () => {
    await signup('ana@example.org', [['where', 'KE']])
    const oldLink = linkIn(mailer.sent.at(-1)!.html, '/confirm')
    clock = new Date(clock.getTime() + 2 * 3_600_000)
    await subscribeAndConfirm('ana@example.org', [['where', 'r:asia']])
    await call(form('/confirm', [['t', new URL(oldLink).searchParams.get('t')!]]))
    expect(subscribers()).toMatchObject([{ where_code: 'r:asia' }])
  })

  test('a daily cap on confirmation emails across all addresses', async () => {
    const e = { ...env(), DAILY_CONFIRM_LIMIT: '2' }
    for (const n of [1, 2, 3]) await call(form('/subscribe', [['email', `p${n}@example.org`], ['consent', 'v1']]), e)
    expect(mailer.sent).toHaveLength(2)
  })

  test('an expired or altered link goes to the expired page', async () => {
    await signup('ana@example.org')
    const link = linkIn(mailer.sent[0]!.html, '/confirm')
    expect((await call(new Request(link + 'x'))).headers.get('Location')).toBe('https://naturefunding.org/digest/link-expired/')
    clock = new Date(clock.getTime() + 4 * 86_400_000)
    expect((await call(new Request(link))).headers.get('Location')).toBe('https://naturefunding.org/digest/link-expired/')
  })
})

describe('the daily run', () => {
  const opened = (at: string): DigestEvent => ({ at, kind: 'opened', programme: openProgramme.id, call: openCall.id })

  test('sends nothing when nothing is new since the sign-up', async () => {
    events = [opened('2026-11-01T00:00:00.000Z')]
    await subscribeAndConfirm('ana@example.org')
    mailer.sent.length = 0
    clock = new Date('2026-11-03T08:00:00Z')
    expect(await runDigest(env(), deps())).toEqual({ due: 1, withNews: 0, sent: 0, mode: 'live' })
    expect(mailer.sent).toHaveLength(0)
  })

  test('sends news once, with one-click unsubscribe, then waits 7 days', async () => {
    await subscribeAndConfirm('ana@example.org')
    mailer.sent.length = 0
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    expect(await runDigest(env(), deps())).toMatchObject({ sent: 1 })
    const email = mailer.sent[0]!
    expect(email.to).toBe('ana@example.org')
    expect(email.html).toContain(openProgramme.name.replaceAll('&', '&amp;'))
    expect(email.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')

    events.push(opened('2026-11-04T00:10:00.000Z'), { ...opened('2026-11-04T00:10:00.000Z'), kind: 'new_programme' })
    clock = new Date('2026-11-05T08:00:00Z')
    expect(await runDigest(env(), deps())).toMatchObject({ due: 0, sent: 0 })
    clock = new Date('2026-11-10T08:00:00Z')
    expect(await runDigest(env(), deps())).toMatchObject({ due: 1, sent: 1 })

    // The mail app's one-click post removes the row.
    const unsub = email.headers!['List-Unsubscribe']!.slice(1, -1)
    const res = await call(new Request(unsub, { method: 'POST', body: new URLSearchParams([['List-Unsubscribe', 'One-Click']]) }))
    expect(res.status).toBe(200)
    expect(subscribers()).toHaveLength(0)
  })

  test('filters: a subscriber whose filters match nothing new gets nothing', async () => {
    const other = (['urban_nature', 'peatlands', 'research'] as const).find((a) => !openProgramme.approaches.includes(a))!
    await subscribeAndConfirm('ana@example.org', [['approach', other]])
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    expect(await runDigest(env(), deps())).toMatchObject({ withNews: 0, sent: 0 })
  })

  test('count-only mode (before the first send is approved) sends and records nothing', async () => {
    await subscribeAndConfirm('ana@example.org')
    mailer.sent.length = 0
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    expect(await runDigest({ ...env(), DIGEST_SENDING: 'off' }, deps())).toEqual({ due: 1, withNews: 1, sent: 0, mode: 'count-only' })
    expect(mailer.sent).toHaveLength(0)
    expect(subscribers()[0]!.last_sent_at).toBeNull()
  })

  test('the daily limit spreads a large list over the following days', async () => {
    for (const n of [1, 2, 3]) {
      await subscribeAndConfirm(`p${n}@example.org`)
      clock = new Date(clock.getTime() + 60_000)
    }
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    expect(await runDigest({ ...env(), DAILY_DIGEST_LIMIT: '2' }, deps())).toMatchObject({ withNews: 3, sent: 2 })
    clock = new Date('2026-11-04T08:00:00Z')
    expect(await runDigest({ ...env(), DAILY_DIGEST_LIMIT: '2' }, deps())).toMatchObject({ due: 1, sent: 1 })
  })

  test('the daily limit counts every run that day', async () => {
    for (const n of [1, 2, 3]) {
      await subscribeAndConfirm(`p${n}@example.org`)
      clock = new Date(clock.getTime() + 60_000)
    }
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    expect(await runDigest({ ...env(), DAILY_DIGEST_LIMIT: '2' }, deps())).toMatchObject({ sent: 2 })
    clock = new Date('2026-11-03T09:00:00Z')
    expect(await runDigest({ ...env(), DAILY_DIGEST_LIMIT: '2' }, deps())).toMatchObject({ sent: 0 })
  })

  test('a send Resend certainly refused is tried again the next day', async () => {
    await subscribeAndConfirm('ana@example.org')
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    const send = mailer.send
    mailer.send = async () => {
      throw new SendFailed('Resend /emails 429: rate limited', false, 429)
    }
    expect(await runDigest(env(), deps())).toMatchObject({ sent: 0 })
    expect(subscribers()[0]!.last_sent_at).toBeNull()
    mailer.send = send
    clock = new Date('2026-11-04T08:00:00Z')
    expect(await runDigest(env(), deps())).toMatchObject({ sent: 1 })
  })

  test('a send that may have gone out (timeout, 5xx, reused key) is kept as sent, never repeated', async () => {
    await subscribeAndConfirm('ana@example.org')
    mailer.sent.length = 0
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    mailer.send = async () => {
      throw new SendFailed('Resend /emails: timed out', null)
    }
    expect(await runDigest(env(), deps())).toMatchObject({ sent: 1 })
    expect(subscribers()[0]!.last_sent_at).toBe('2026-11-03T08:00:00.000Z')
    clock = new Date('2026-11-04T08:00:00Z')
    expect(await runDigest(env(), deps())).toMatchObject({ due: 0, sent: 0 })
  })

  test('one address the provider refuses doesn\u2019t hold back the others', async () => {
    for (const n of [1, 2, 3]) {
      await subscribeAndConfirm(`p${n}@example.org`)
      clock = new Date(clock.getTime() + 60_000)
    }
    mailer.sent.length = 0
    const send = mailer.send
    mailer.send = async (e, key) => {
      if (e.to === 'p1@example.org') throw new SendFailed('Resend /emails 422: invalid address', false, 422)
      return send(e, key)
    }
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    expect(await runDigest(env(), deps())).toMatchObject({ sent: 2 })
    expect(mailer.sent.map((e) => e.to)).toEqual(['p2@example.org', 'p3@example.org'])
    expect(mailer.keys.at(-1)).toMatch(/^digest\/2026-11-03\//)
    expect(subscribers().find((r) => r.email === 'p1@example.org')!.last_sent_at).toBeNull()
  })

  test('a change committed before a send but deployed after it goes in the next digest', async () => {
    await subscribeAndConfirm('ana@example.org')
    mailer.sent.length = 0
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    // The running bundle's newest commit is from 00:10; a change at 07:59 is deployed later.
    expect(await runDigest(env(), { ...deps(), coveredUntil: '2026-11-03T00:10:00.000Z' })).toMatchObject({ sent: 1 })
    events = [opened('2026-11-03T00:10:00.000Z'), { ...opened('2026-11-03T07:59:00.000Z'), kind: 'new_programme' }]
    clock = new Date('2026-11-10T08:00:00Z')
    expect(await runDigest(env(), { ...deps(), coveredUntil: '2026-11-03T07:59:00.000Z' })).toMatchObject({ sent: 1 })
    expect(mailer.sent).toHaveLength(2)
  })

  test('the unsubscribe link in the email opens a page; its button removes the address', async () => {
    await subscribeAndConfirm('ana@example.org')
    events = [opened('2026-11-03T00:10:00.000Z')]
    clock = new Date('2026-11-03T08:00:00Z')
    await runDigest(env(), deps())
    const link = linkIn(mailer.sent.at(-1)!.html, '/unsubscribe')
    expect(await (await call(new Request(link))).text()).toContain('Unsubscribe')
    expect(subscribers()).toHaveLength(1)
    const res = await call(form('/unsubscribe', [['t', new URL(link).searchParams.get('t')!]]))
    expect(res.headers.get('Location')).toBe('https://naturefunding.org/digest/unsubscribed/')
    expect(subscribers()).toHaveLength(0)
  })
})
