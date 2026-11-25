// One subscriber's digest: the events since their last email that still hold in today's data and match their
// saved filters; a call for other countries than theirs is never theirs. A call that opened and closed again between two emails is left out; so is a programme removed
// from the site. Nothing left means no email.
import type { Call, Programme } from '../../src/data/schema'
import type { DigestEvent } from './events'
import { effectiveCallStatus } from '../../src/lib/status'
import { callTakes, placeFit } from '../../src/lib/where-codes'
import { matches, type Prefs } from './match'

export type Section = 'open' | 'upcoming' | 'new'
export type DigestItem = { section: Section; programme: Programme; call: Call | null }
/** `items` is capped at MAX_ITEMS; `total` counts everything, `check` those that may not take the place, `counts` the rest. */
export type Digest = { items: DigestItem[]; total: number; counts: Record<Section, number>; check: number }

/** More than this and the email says how many more there are, with a link to the site. */
export const MAX_ITEMS = 25

/** The call with the status its dates give at the send (08:00 UTC), in the funder's own time zone, as on the site. */
const dated = (c: Call, now: Date): Call => ({ ...c, status: effectiveCallStatus(c, now) })

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
      // One line per new programme, with the call live now for the subscriber's place, if any.
      if (byKey.has(p.id)) continue
      const calls = p.calls.filter((c) => callTakes(c, prefs.where)).map((c) => dated(c, at))
      const call = calls.find((c) => c.status === 'open') ?? calls.find((c) => c.status === 'upcoming') ?? null
      byKey.set(p.id, { section: 'new', programme: p, call })
      continue
    }
    const stored = p.calls.find((c) => c.id === e.call)
    if (!stored || !callTakes(stored, prefs.where)) continue
    const call = dated(stored, at)
    const section: Section | null = call.status === 'open' ? 'open' : call.status === 'upcoming' ? 'upcoming' : null
    if (!section) continue
    byKey.set(`${p.id}/${call.id}`, { section, programme: p, call })
  }

  const order: Record<Section, number> = { open: 0, upcoming: 1, new: 2 }
  const open = (i: DigestItem) => i.call?.deadline?.date ?? '9999'
  const soon = (i: DigestItem) => i.call?.opens ?? '9999'
  // New programmes you can apply to now come first, then those with a call announced, then the rest by name.
  const sortKey = (i: DigestItem) =>
    i.section === 'open'
      ? open(i)
      : i.section === 'upcoming'
        ? soon(i)
        : !i.call
          ? '2'
          : i.call.status === 'open'
            ? `0${open(i)}`
            : `1${soon(i)}`
  // One line per programme: a funder with several rounds open (one per meeting date) shows its next one.
  const seen = new Set<string>()
  const items = [...byKey.values()]
    .sort((a, b) => order[a.section] - order[b.section] || sortKey(a).localeCompare(sortKey(b)) || a.programme.name.localeCompare(b.programme.name))
    .filter((i) => !seen.has(i.programme.id) && !!seen.add(i.programme.id))
  const counts = { open: 0, upcoming: 0, new: 0 }
  let check = 0
  for (const i of items) placeFit(i.programme, prefs.where) === 'check' ? check++ : counts[i.section]++
  return { items: items.slice(0, MAX_ITEMS), total: items.length, counts, check }
}
