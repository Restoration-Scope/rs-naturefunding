// Resend's webhook (POST /resend/webhook): an address that hard-bounces or marks the email as spam is deleted, as an
// unsubscribe would, so the list never keeps mailing it. Resend signs each call the Svix way: HMAC-SHA256 of
// "<svix-id>.<svix-timestamp>.<body>" with the endpoint's signing secret (whsec_<base64>). Made by
// scripts/setup-webhook.ts, which also sets RESEND_WEBHOOK_SECRET.
import type { D1 } from './app'

/** Svix rejects calls older or newer than this; so do we, against replays. */
const TOLERANCE_S = 5 * 60

const b64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))

export async function svixSignature(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)))
}

/** True when one of the `v1,<sig>` entries in svix-signature matches and the timestamp is recent. */
export async function verified(request: Request, body: string, secret: string, now: Date): Promise<boolean> {
  const id = request.headers.get('svix-id')
  const ts = request.headers.get('svix-timestamp')
  const sigs = request.headers.get('svix-signature')
  if (!id || !ts || !sigs || !/^\d+$/.test(ts)) return false
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > TOLERANCE_S) return false
  const expected = await svixSignature(secret, id, ts, body)
  let ok = false
  for (const s of sigs.split(' ')) {
    const [version, sig = ''] = s.split(',')
    // Every candidate is compared in full, so the time taken doesn't say which bytes matched.
    if (version === 'v1' && sig.length === expected.length) {
      let diff = 0
      for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
      ok ||= diff === 0
    }
  }
  return ok
}

type Event = { type?: string; data?: { to?: string[] | string; bounce?: { type?: string } } }

export async function resendWebhook(request: Request, env: { DB: D1; RESEND_WEBHOOK_SECRET?: string }, now: Date): Promise<Response> {
  if (!env.RESEND_WEBHOOK_SECRET) return new Response('Not set up', { status: 503 })
  const body = await request.text()
  if (!(await verified(request, body, env.RESEND_WEBHOOK_SECRET, now))) return new Response('Bad signature', { status: 401 })
  const event = JSON.parse(body) as Event
  // A transient bounce (a full mailbox, a server down) may clear; Resend's email.bounced is otherwise permanent.
  const drop = event.type === 'email.complained' || (event.type === 'email.bounced' && event.data?.bounce?.type !== 'Transient')
  if (drop) {
    const to = [event.data?.to ?? []].flat()
    for (const address of to) await env.DB.prepare('DELETE FROM subscribers WHERE email = ?1').bind(address.trim().toLowerCase()).run()
    console.log('digest webhook: removed after', event.type, to.length)
  }
  return new Response('ok')
}
