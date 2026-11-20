import type { Call } from '../data/schema'
import type { State } from './labels'
import { dateIn, deadlinePassed as passed } from './deadline'

type Deadline = NonNullable<Call['deadline']>
type CallStatus = Call['status']

const UTC = 'UTC'
const dayMs = 86_400_000

/** YYYY-MM-DD for an instant in the call's own timezone (src/lib/deadline.ts reads the funder's wording). */
export const dateKey = (date = new Date(), timeZone?: string): string => dateIn(date, timeZone)

export const utcDateKey = (date = new Date()) => dateKey(date)

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / dayMs)
}

export function callTimeZone(call: Pick<Call, 'deadline'>): string | undefined {
  return call.deadline?.timezone
}

/** A deadline closes after its stated instant in the funder's timezone; one we can't read never closes early. */
export function deadlinePassed(deadline: Pick<Deadline, 'date' | 'time' | 'timezone'>, now = new Date()): boolean {
  return passed(deadline, now)
}

export function openingReached(call: Pick<Call, 'opens' | 'deadline'>, now = new Date()): boolean {
  return !!call.opens && dateKey(now, callTimeZone(call)) >= call.opens
}

export function effectiveCallStatus(call: Pick<Call, 'status' | 'opens' | 'deadline'>, now = new Date()): CallStatus {
  if (call.status === 'suspended' || call.status === 'unknown') return call.status
  if (call.deadline && deadlinePassed(call.deadline, now)) return 'closed'
  if (call.status === 'upcoming' && openingReached(call, now)) return 'open'
  if (call.status === 'open' && call.opens && !openingReached(call, now)) return 'upcoming'
  return call.status
}

export function effectiveListingState(state: State, call: Pick<Call, 'opens' | 'deadline'>, now = new Date()): State {
  if (state === 'rolling' || state === 'none') return state
  const effective = effectiveCallStatus({ status: state, opens: call.opens, deadline: call.deadline }, now)
  return effective === 'suspended' || effective === 'unknown' ? 'none' : effective
}

const shortFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: UTC })
const longFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: UTC })

export const shortDateText = (iso: string): string => shortFmt.format(new Date(`${iso}T00:00:00Z`))
export const longDateText = (iso: string): string => longFmt.format(new Date(`${iso}T00:00:00Z`))

export function daysLeft(deadline: Pick<Deadline, 'date' | 'timezone'>, now = new Date()): number {
  return daysBetween(dateKey(now, deadline.timezone), deadline.date)
}
