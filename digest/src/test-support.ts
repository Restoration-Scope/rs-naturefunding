// Test doubles: D1 on bun:sqlite with the real schema, and a mailer that records what it would send.
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { D1, D1Statement } from './app'
import type { Mailer, Outgoing } from './resend'

export function memoryD1(): D1 & { sqlite: Database } {
  const sqlite = new Database(':memory:')
  sqlite.run(readFileSync(join(import.meta.dir, '..', 'schema.sql'), 'utf8'))
  const stmt = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...v) => stmt(sql, v),
    first: async () => (sqlite.query(sql).get(...(values as never[])) as never) ?? null,
    all: async () => ({ results: sqlite.query(sql).all(...(values as never[])) as never[] }),
    run: async () => sqlite.query(sql).run(...(values as never[])),
  })
  return { sqlite, prepare: (sql) => stmt(sql) }
}

export function recordingMailer(): Mailer & { sent: Outgoing[]; keys: (string | undefined)[] } {
  const sent: Outgoing[] = []
  const keys: (string | undefined)[] = []
  return {
    sent,
    keys,
    async send(e, key) {
      sent.push(e)
      keys.push(key)
      return { id: `email-${sent.length}` }
    },
  }
}
