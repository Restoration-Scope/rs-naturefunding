import type { Call } from '../data/schema'
import type { State } from './labels'

type Deadline = NonNullable<Call['deadline']>
type CallStatus = Call['status']

const UTC = 'UTC'
const dayMs = 86_400_000

/** YYYY-MM-DD for an instant in the call's own timezone. */
export function dateKey(date = new Date(), timeZone = UTC): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const part = (type: string) => parts.find((p) => p.type === type)?.value
    return `${part('year')}-${part('month')}-${part('day')}`
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export const utcDateKey = (date = new Date()) => dateKey(date, UTC)

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / dayMs)
}

export function callTimeZone(call: Pick<Call, 'deadline'>): string {
  return call.deadline?.timezone ?? UTC
}

function timeZoneOffsetMs(timeZone: string, atUtcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(atUtcMs))
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second')) - atUtcMs
}

/** Convert a local wall-clock time in an IANA zone to UTC. */
export function zonedDateTimeMs(date: string, time: string, timeZone = UTC): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  try {
    let utc = wallAsUtc - timeZoneOffsetMs(timeZone, wallAsUtc)
    utc = wallAsUtc - timeZoneOffsetMs(timeZone, utc)
    return utc
  } catch {
    return wallAsUtc
  }
}

/** A date-only deadline closes after that whole local date; a timed deadline closes after that instant. */
export function deadlinePassed(deadline: Pick<Deadline, 'date' | 'time' | 'timezone'>, now = new Date()): boolean {
  if (deadline.time) return now.getTime() > zonedDateTimeMs(deadline.date, deadline.time, deadline.timezone)
  return dateKey(now, deadline.timezone ?? UTC) > deadline.date
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
  return daysBetween(dateKey(now, deadline.timezone ?? UTC), deadline.date)
}
