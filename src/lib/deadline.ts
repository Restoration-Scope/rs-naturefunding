/**
 * When a stated deadline has passed, shared by the site (src/lib/status.ts) and refresh (scripts/refresh).
 * In the funder's timezone when the page states one we can read, else at the end of the day in UTC.
 * A timezone we can't read moves the cut-off to the latest place on Earth (UTC-12), so a call is never
 * closed early. Browser-safe: no Node imports.
 */
import type { z } from 'zod'
import type { deadline as deadlineSchema } from '../data/schema'

type Deadline = z.infer<typeof deadlineSchema>

/**
 * Offsets in minutes for abbreviations and names funders write. Ambiguous ones (IST, CST in Asia) are left out
 * on purpose. A summer-time name reads as its standard-time partner, an hour later: funders write "CEST" for a
 * February deadline, and a call that closes an hour late beats one that closes an hour early.
 */
const NAMES: Record<string, number> = {
  UTC: 0, GMT: 0, Z: 0, WET: 0, WEST: 0, BST: 0, CET: 60, CEST: 60, MEZ: 60, MESZ: 60, EET: 120, EEST: 120,
  WAT: 60, CAT: 120, SAST: 120, EAT: 180, MSK: 180,
  EST: -300, EDT: -300, CDT: -360, MST: -420, MDT: -420, PST: -480, PDT: -480, AKST: -540, AKDT: -540, HST: -600,
  AST: -240, ADT: -240, NST: -210, NDT: -210,
  BRT: -180, ART: -180, CLT: -240, CLST: -240, COT: -300, PET: -300,
  ICT: 420, WIB: 420, SGT: 480, HKT: 480, JST: 540, KST: 540, AEST: 600, AEDT: 600, NZST: 720, NZDT: 720,
  'COORDINATED UNIVERSAL TIME': 0, 'GREENWICH MEAN TIME': 0,
  'CENTRAL EUROPEAN TIME': 60, 'CENTRAL EUROPEAN SUMMER TIME': 60, 'BRUSSELS TIME': 60,
  'EASTERN EUROPEAN TIME': 120, 'WEST AFRICA TIME': 60, 'CENTRAL AFRICA TIME': 120, 'EAST AFRICA TIME': 180,
  'SOUTH AFRICA STANDARD TIME': 120, 'ZIMBABWE TIME': 120,
  'EASTERN TIME': -300, 'EASTERN STANDARD TIME': -300, 'EASTERN DAYLIGHT TIME': -300, 'WASHINGTON, D.C. TIME': -300,
  'CENTRAL TIME': -360, 'CENTRAL STANDARD TIME': -360, 'MOUNTAIN TIME': -420, 'MOUNTAIN STANDARD TIME': -420,
  'PACIFIC TIME': -480, 'PACIFIC STANDARD TIME': -480, 'PACIFIC DAYLIGHT TIME': -480,
  'ATLANTIC STANDARD TIME': -240, 'ATLANTIC TIME': -240,
  'INDOCHINA TIME': 420, 'JAPAN STANDARD TIME': 540, 'AUSTRALIAN EASTERN STANDARD TIME': 600,
}

/** The latest offset on Earth: a date has not ended anywhere until it ends here. */
const LATEST_OFFSET = -12 * 60

export type Zone = { kind: 'offset'; minutes: number } | { kind: 'iana'; name: string }

const OFFSET = String.raw`(?:UTC|GMT)\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?`

const offsetZone = (sign: string, h: string, m = '0'): Zone => {
  const minutes = Number(h) * 60 + Number(m)
  return { kind: 'offset', minutes: sign === '+' ? minutes : -minutes }
}

// The MCP Worker judges every listing on each search (mcp/), so zones, formatters and instants are worked out once.
const zones = new Map<string, Zone | null>()
const formats = new Map<string, Intl.DateTimeFormat>()
const instants = new Map<string, number>()

/** A timezone as a funder wrote it: an IANA name, "UTC+1", "+05:30", an abbreviation or a common name, or null. */
export function parseZone(text: string): Zone | null {
  if (!zones.has(text)) zones.set(text, readZone(text))
  return zones.get(text)!
}

function readZone(text: string): Zone | null {
  const t = text.trim()
  const bare = /^(?:UTC|GMT)?\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(t)
  if (bare) return offsetZone(bare[1]!, bare[2]!, bare[3])
  // A stated offset beside a name wins: "CET (UTC+1)", "EDT (UTC-4)".
  const stated = new RegExp(String.raw`\(\s*${OFFSET}\s*\)`, 'i').exec(t)
  if (stated) return offsetZone(stated[1]!, stated[2]!, stated[3])
  const name = NAMES[t.toUpperCase().replace(/\s+/g, ' ')]
  if (name !== undefined) return { kind: 'offset', minutes: name }
  try {
    new Intl.DateTimeFormat('en', { timeZone: t })
    return { kind: 'iana', name: t }
  } catch {
    return null
  }
}

/** Minutes the zone is ahead of UTC at a given instant. */
function offsetAt(zone: Zone, at: number): number {
  if (zone.kind === 'offset') return zone.minutes
  let format = formats.get(zone.name)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone.name, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formats.set(zone.name, format)
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(at)).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000)
}

/** The wall-clock time in a zone, as a UTC instant. */
function wallToInstant(wall: number, zone: Zone): number {
  let instant = wall - offsetAt(zone, wall) * 60_000
  instant = wall - offsetAt(zone, instant) * 60_000
  return instant
}

/** The last millisecond at which the call still takes applications. */
export function deadlineInstant(d: Pick<Deadline, 'date' | 'time' | 'timezone'>): Date {
  const key = `${d.date} ${d.time ?? ''} ${d.timezone ?? ''}`
  let at = instants.get(key)
  if (at === undefined) instants.set(key, (at = instantOf(d)))
  return new Date(at)
}

function instantOf(d: Pick<Deadline, 'date' | 'time' | 'timezone'>): number {
  const [y, m, day] = d.date.split('-').map(Number) as [number, number, number]
  const endOfDay = Date.UTC(y, m - 1, day, 23, 59, 59, 999)
  if (!d.timezone) return endOfDay

  const zone = parseZone(d.timezone)
  if (!zone) return endOfDay - LATEST_OFFSET * 60_000

  const wall = d.time ? Date.UTC(y, m - 1, day, Number(d.time.slice(0, 2)), Number(d.time.slice(3, 5))) : endOfDay
  return wallToInstant(wall, zone)
}

export const deadlinePassed = (d: Pick<Deadline, 'date' | 'time' | 'timezone'>, now: Date) =>
  now.getTime() > deadlineInstant(d).getTime()

/** YYYY-MM-DD for an instant in a funder's timezone: UTC when none is stated, UTC-12 when we can't read it. */
export function dateIn(date: Date, timezone?: string): string {
  const zone: Zone = timezone ? (parseZone(timezone) ?? { kind: 'offset', minutes: LATEST_OFFSET }) : { kind: 'offset', minutes: 0 }
  return new Date(date.getTime() + offsetAt(zone, date.getTime()) * 60_000).toISOString().slice(0, 10)
}
