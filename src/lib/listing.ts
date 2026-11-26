// A programme's state today, from its calls: pure, no file reads, so the site's build and the MCP Worker
// (mcp/) judge status, freshness and order the same way. data.ts re-exports all of it.
import type { Call, Programme } from '../data/schema'
import type { State } from './labels'
import { daysBetween, effectiveCallStatus, utcDateKey } from './status'
import { callTakes } from './where-codes'

export const AGING_DAYS = 30
export const HIDDEN_DAYS = 90

export type Listing = {
  p: Programme
  /** The place whose calls set the state: "KE", "r:africa" or '' for every call. */
  where: string
  state: State
  /** The call that sets the state: the open call closing soonest, else the next upcoming one, else the latest closed one. */
  call: Call | null
  ageDays: number
  aging: boolean
}

const byDeadline = (a: Call, b: Call) => (a.deadline?.date ?? '9999').localeCompare(b.deadline?.date ?? '9999')

/** `where`: only the calls that take projects from it set the state. */
export function listingFor(p: Programme, today: string | Date, where = ''): Listing {
  const now = typeof today === 'string' ? new Date(`${today}T12:00:00Z`) : today
  const todayKey = utcDateKey(now)
  const ageDays = daysBetween(p.checked_at, todayKey)
  const base = { p, where, ageDays, aging: ageDays > AGING_DAYS }
  if (p.access === 'intermediary' || p.access === 'invitation_only') return { ...base, state: 'none', call: null }
  const calls = p.calls.filter((c) => callTakes(c, where))
  const status = new Map(calls.map((c) => [c, effectiveCallStatus(c, now)]))

  const open = calls.filter((c) => status.get(c) === 'open').sort(byDeadline)
  // An open call with no deadline is rolling only when the funder says so; otherwise it is open with an undated window.
  if (open[0]) return { ...base, state: p.window === 'rolling' ? 'rolling' : 'open', call: open[0] }

  const upcoming = calls
    .filter((c) => status.get(c) === 'upcoming')
    .sort((a, b) => (a.opens ?? '9999').localeCompare(b.opens ?? '9999'))
  if (upcoming[0]) return { ...base, state: 'upcoming', call: upcoming[0] }

  // Yearly windows where the page doesn't say whether one is open now: no open call, but the dates are worth showing.
  const recurring = calls.find((c) => c.status === 'unknown' && c.recurring)
  if (recurring) return { ...base, state: 'none', call: recurring }

  const past = calls.filter((c) => status.get(c) === 'closed').sort(byDeadline).reverse()
  if (past[0]) return { ...base, state: 'closed', call: past[0] }
  return { ...base, state: 'none', call: null }
}

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "mid-March 2027" → 2027-03-15, only to sort; the funder's wording is what we show. A bare year sorts at its end. */
export function expectedSortDate(text: string | undefined): string | undefined {
  const year = text?.match(/\b(20\d\d)\b/)?.[1]
  if (!text || !year) return undefined
  const m = monthNames.findIndex((n) => new RegExp(`\\b${n}`, 'i').test(text))
  if (m < 0) return `${year}-12-31`
  const day = text.match(/\b(\d{1,2})\b/)?.[1] ?? (/early/i.test(text) ? '5' : /mid/i.test(text) ? '15' : /late|end/i.test(text) ? '25' : '1')
  return `${year}-${String(m + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** When an upcoming call opens, for sorting: its date, else the funder's expected month or year. */
export const opensSortDate = (c: Call | null) => c?.opens ?? expectedSortDate(c?.expected)

const stateOrder: Record<State, number> = { open: 0, rolling: 1, upcoming: 2, none: 3, closed: 4 }

/** Soonest deadline first; rolling, upcoming (by opening date), no-call and closed after. */
export function sortListings(a: Listing, b: Listing) {
  const s = stateOrder[a.state] - stateOrder[b.state]
  if (s) return s
  const key = (l: Listing) =>
    l.state === 'upcoming' ? (opensSortDate(l.call) ?? l.call?.deadline?.date ?? '9999') : (l.call?.deadline?.date ?? '9999')
  // Closed calls: most recently closed first.
  const k = key(a).localeCompare(key(b)) * (a.state === 'closed' ? -1 : 1)
  return k || a.p.name.localeCompare(b.p.name)
}
