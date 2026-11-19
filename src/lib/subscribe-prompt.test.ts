import { describe, expect, test } from 'bun:test'
import { CLOSED_REST, SEEN_REST, mayAsk } from './subscribe-prompt'

const now = Date.UTC(2026, 10, 18)

describe('mayAsk', () => {
  test('asks a first-time reader', () => expect(mayAsk({}, now)).toBe(true))
  test('never asks after a sign-up', () => expect(mayAsk({ subscribed: true }, now)).toBe(false))
  test('rests an hour once seen, a day once closed', () => {
    expect(SEEN_REST).toBe(3_600_000)
    expect(CLOSED_REST).toBe(24 * 3_600_000)
    expect(mayAsk({ next: now + 1 }, now)).toBe(false)
    expect(mayAsk({ next: now }, now)).toBe(true)
  })
  test('never asks without storage', () => expect(mayAsk(null, now)).toBe(false))
})
