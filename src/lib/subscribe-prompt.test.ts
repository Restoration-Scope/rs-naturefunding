import { describe, expect, test } from 'bun:test'
import { QUIET_DAYS, mayAsk } from './subscribe-prompt'

const now = Date.UTC(2026, 10, 18)
const day = 86_400_000

describe('mayAsk', () => {
  test('asks a first-time reader', () => expect(mayAsk({}, now)).toBe(true))
  test('never asks after a sign-up', () => expect(mayAsk({ subscribed: true }, now)).toBe(false))
  test('stays quiet for a month after a close', () => {
    expect(mayAsk({ dismissedAt: now - (QUIET_DAYS - 1) * day }, now)).toBe(false)
    expect(mayAsk({ dismissedAt: now - (QUIET_DAYS + 1) * day }, now)).toBe(true)
  })
  test('never asks without storage', () => expect(mayAsk(null, now)).toBe(false))
})
