// One subscriber's digest: the events since their last email that still hold in today's data and match their
// saved filters. A call that opened and closed again between two emails is left out; so is a programme removed
// from the site. Nothing left means no email.
import { deadlinePassed } from '../../scripts/refresh/deadline'
import type { Call, Programme } from '../../src/data/schema'
import type { DigestEvent } from './events'
import { matches, type Prefs } from './match'

export type Section = 'open' | 'upcoming' | 'new'
export type DigestItem = { section: Section; programme: Programme; call: Call | null }
/** `items` is capped at MAX_ITEMS; `counts` and `total` count everything. */
export type Digest = { items: DigestItem[]; total: number; counts: Record<Section, number> }

/** More than this and the email says how many more there are, with a link to the site. */
export const MAX_ITEMS = 25

// The deadline in the funder's own time zone, as the refresh reads it: the email goes out at 08:00 UTC.
const isOpen = (c: Call, now: Date) => c.status === 'open' && !(c.deadline && deadlinePassed(c.deadline, now))

export function buildDigest(
  events: DigestEvent[],
  programmes: Map<string, Programme>,
  prefs: Prefs,
  since: string,
  now: string,
): Digest {
  const at = new Date(now)
  const window = events.filter((e) => e.at > since && e.at <= now)
  const isNew = new Set(window.filter((e) => e.kind === 'new_programme').map((e) => e.programme))
  const byKey = new Map<string, DigestItem>()

  for (const e of window) {
    const p = programmes.get(e.programme)
    if (!p || !matches(p, prefs)) continue
    if (isNew.has(p.id)) {
      // One line per new programme, with the call that's live now, if any.
      if (byKey.has(p.id)) continue
      const call = p.calls.find((c) => isOpen(c, at)) ?? p.calls.find((c) => c.status === 'upcoming') ?? null
      byKey.set(p.id, { section: 'new', programme: p, call })
      continue
    }
    const call = p.calls.find((c) => c.id === e.call)
    if (!call) continue
    const section: Section | null = isOpen(call, at) ? 'open' : call.status === 'upcoming' ? 'upcoming' : null
    if (!section) continue
    byKey.set(`${p.id}/${call.id}`, { section, programme: p, call })
  }

  const order: Record<Section, number> = { open: 0, upcoming: 1, new: 2 }
  const sortKey = (i: DigestItem) =>
    i.section === 'open' ? (i.call?.deadline?.date ?? '9999') : i.section === 'upcoming' ? (i.call?.opens ?? '9999') : ''
  const items = [...byKey.values()].sort(
    (a, b) => order[a.section] - order[b.section] || sortKey(a).localeCompare(sortKey(b)) || a.programme.name.localeCompare(b.programme.name),
  )
  const counts = { open: 0, upcoming: 0, new: 0 }
  for (const i of items) counts[i.section]++
  return { items: items.slice(0, MAX_ITEMS), total: items.length, counts }
}
