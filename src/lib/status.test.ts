import { describe, expect, test } from 'bun:test'
import type { Call } from '../data/schema'
import { deadlinePassed, effectiveCallStatus, openingReached } from './status'

const evidence = {
  source_url: 'https://example.org/call',
  quote: 'Applications for this round open and close on the stated dates in 2026.',
  checked_at: '2026-01-01',
  method: 'human',
} as const

const call = (overrides: Partial<Call>): Call => ({
  id: 'test-call',
  label: 'Test call',
  url: 'https://example.org/call',
  status: 'upcoming',
  opens: null,
  deadline: null,
  evidence: { status: evidence },
  ...overrides,
})

describe('dated call status', () => {
  test('an upcoming call opens on its opening date in the call timezone', () => {
    const c = call({
      opens: '2026-11-15',
      deadline: { date: '2026-12-01', timezone: 'America/Los_Angeles', text: 'Deadline: 1 December 2026' },
    })

    expect(openingReached(c, new Date('2026-11-15T07:59:00Z'))).toBe(false)
    expect(effectiveCallStatus(c, new Date('2026-11-15T07:59:00Z'))).toBe('upcoming')
    expect(openingReached(c, new Date('2026-11-15T08:00:00Z'))).toBe(true)
    expect(effectiveCallStatus(c, new Date('2026-11-15T08:00:00Z'))).toBe('open')
  })

  test('a date-only deadline stays open through the whole local deadline date', () => {
    const c = call({
      status: 'open',
      deadline: { date: '2026-11-20', timezone: 'Pacific/Kiritimati', text: 'Deadline: 20 November 2026' },
    })

    expect(deadlinePassed(c.deadline!, new Date('2026-11-20T09:59:00Z'))).toBe(false)
    expect(effectiveCallStatus(c, new Date('2026-11-20T09:59:00Z'))).toBe('open')
    expect(deadlinePassed(c.deadline!, new Date('2026-11-20T10:01:00Z'))).toBe(true)
    expect(effectiveCallStatus(c, new Date('2026-11-20T10:01:00Z'))).toBe('closed')
  })

  test('a timed deadline closes after the exact instant in its timezone', () => {
    const c = call({
      status: 'open',
      deadline: { date: '2026-11-18', time: '17:00', timezone: 'America/New_York', text: 'Deadline: 18 November 2026, 17:00' },
    })

    expect(deadlinePassed(c.deadline!, new Date('2026-11-18T21:59:00Z'))).toBe(false)
    expect(effectiveCallStatus(c, new Date('2026-11-18T21:59:00Z'))).toBe('open')
    expect(deadlinePassed(c.deadline!, new Date('2026-11-18T22:01:00Z'))).toBe(true)
    expect(effectiveCallStatus(c, new Date('2026-11-18T22:01:00Z'))).toBe('closed')
  })

  test('an upcoming call whose whole window passed becomes closed', () => {
    const c = call({
      opens: '2026-11-15',
      deadline: { date: '2026-11-16', timezone: 'UTC', text: 'Deadline: 16 November 2026' },
    })

    expect(effectiveCallStatus(c, new Date('2026-11-17T00:00:00Z'))).toBe('closed')
  })
})
