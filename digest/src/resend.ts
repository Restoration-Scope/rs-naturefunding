// Sending through Resend's HTTP API (https://resend.com/docs/api-reference). No SDK: one endpoint.
export type Outgoing = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }

/**
 * A send Resend refused. `accepted` is false when it certainly sent nothing (a 4xx it answered: a bad request or a
 * rate limit), and null when it may have (a 5xx, a timeout, a dropped connection, or a 409 on a reused
 * idempotency key, which means that key's earlier request was taken or is still running).
 */
export class SendFailed extends Error {
  constructor(
    message: string,
    readonly accepted: false | null,
    readonly status?: number,
  ) {
    super(message)
  }
}

export type Mailer = { send(email: Outgoing, idempotencyKey?: string): Promise<{ id: string }> }

export function resendMailer(o: { apiKey: string; from: string; baseUrl?: string; testRecipient?: string }): Mailer {
  const base = o.baseUrl ?? 'https://api.resend.com'
  // A test recipient (Resend's delivered@resend.dev) gets every email instead of the real address.
  const body = (e: Outgoing) => ({ from: o.from, to: [o.testRecipient || e.to], subject: e.subject, html: e.html, text: e.text, headers: e.headers })
  async function post(path: string, payload: unknown, idempotencyKey?: string) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${o.apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => {
      throw new SendFailed(`Resend ${path}: ${e instanceof Error ? e.message : String(e)}`, null)
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const certain = res.status >= 400 && res.status < 500 && res.status !== 409 && res.status !== 408
      throw new SendFailed(`Resend ${path} ${res.status}: ${String(json.message ?? json.name ?? 'error')}`, certain ? false : null, res.status)
    }
    return json
  }
  return {
    async send(e, key) {
      const r = await post('/emails', body(e), key)
      return { id: String(r.id) }
    },
  }
}
