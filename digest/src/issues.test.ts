import { expect, test } from 'bun:test'
import { issueWeeks } from './issues'

test('weeks end on Monday 08:00 UTC, newest first; the first is a full week in and takes everything before it', () => {
  // First change on Sunday 1 November; built on Tuesday 17 November.
  expect(issueWeeks('2026-11-01T19:00:00.000Z', '2026-11-17T03:00:00.000Z')).toEqual([
    { date: '2026-11-16', since: '2026-11-09T08:00:00.000Z', until: '2026-11-16T08:00:00.000Z' },
    { date: '2026-11-09', since: '', until: '2026-11-09T08:00:00.000Z' },
  ])
  // A first change on Monday after 08:00: its first issue is two Mondays on; the week still running waits.
  expect(issueWeeks('2026-11-02T09:00:00.000Z', '2026-11-16T07:59:00.000Z')).toEqual([])
  expect(issueWeeks('2026-11-02T09:00:00.000Z', '2026-11-16T08:00:00.000Z').map((w) => w.date)).toEqual(['2026-11-16'])
})
