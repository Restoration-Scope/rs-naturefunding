/**
 * When a stated deadline has passed. In the funder's timezone when the page states one,
 * else at the end of the day in UTC. A timezone we can't read moves the cut-off to the
 * latest place on Earth (UTC-12), so a call is never closed early.
 */
import type { z } from 'zod'
import type { deadline as deadlineSchema } from '../../src/data/schema'

type Deadline = z.infer<typeof deadlineSchema>

/** Offsets in minutes for abbreviations funders write. Ambiguous ones (IST, CST in Asia) are left out on purpose. */
const ABBREVIATIONS: Record<string, number> = {
  UTC: 0, GMT: 0, Z: 0, WET: 0, BST: 60, WEST: 60, CET: 60, CEST: 120, EET: 120, EEST: 180,
  WAT: 60, CAT: 120, SAST: 120, EAT: 180, MSK: 180,
  EST: -300, EDT: -240, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420, AKST: -540, HST: -600,
  BRT: -180, ART: -180, CLT: -240, COT: -300, PET: -300,
  ICT: 420, WIB: 420, SGT: 480, HKT: 480, JST: 540, KST: 540, AEST: 600, AEDT: 660, NZST: 720, NZDT: 780,
}

const LATEST_OFFSET = -12 * 60

type Zone = { kind: 'offset'; minutes: number } | { kind: 'iana'; name: string }

export function parseZone(text: string): Zone | null {
  const t = text.trim()
  const offset = /^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(t)
  if (offset) {
    const minutes = Number(offset[2]) * 60 + Number(offset[3] ?? 0)
    return { kind: 'offset', minutes: offset[1] === '-' ? -minutes : minutes }
  }
  const abbr = ABBREVIATIONS[t.toUpperCase()]
  if (abbr !== undefined) return { kind: 'offset', minutes: abbr }
  try {
    new Intl.DateTimeFormat('en', { timeZone: t })
    return { kind: 'iana', name: t }
  } catch {
    return null
  }
}

/** Minutes the zone is ahead of UTC at a given instant. */
function ianaOffset(name: string, at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: name, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(at)).map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000)
}

/** The wall-clock time in a zone, as a UTC instant. */
function wallToInstant(wall: number, zone: Zone): number {
  if (zone.kind === 'offset') return wall - zone.minutes * 60_000
  let instant = wall - ianaOffset(zone.name, wall) * 60_000
  instant = wall - ianaOffset(zone.name, instant) * 60_000
  return instant
}

/** The last millisecond at which the call still takes applications. */
export function deadlineInstant(d: Deadline): Date {
  const [y, m, day] = d.date.split('-').map(Number)
  const endOfDay = Date.UTC(y, m - 1, day, 23, 59, 59, 999)
  if (!d.timezone) return new Date(endOfDay)

  const zone = parseZone(d.timezone)
  if (!zone) return new Date(endOfDay - LATEST_OFFSET * 60_000)

  const wall = d.time
    ? Date.UTC(y, m - 1, day, Number(d.time.slice(0, 2)), Number(d.time.slice(3, 5)))
    : endOfDay
  return new Date(wallToInstant(wall, zone))
}

export const deadlinePassed = (d: Deadline, now: Date) => now.getTime() > deadlineInstant(d).getTime()
