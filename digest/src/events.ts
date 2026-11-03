// What the digest reports: programmes and calls that are new, newly open or newly announced. Events come from
// comparing two snapshots of data/programmes (one per commit on main); only ids and statuses are read, so a
// snapshot from an older schema still compares.

export type EventKind = 'new_programme' | 'opened' | 'announced'

export type DigestEvent = {
  /** When the change reached main (commit date, ISO). */
  at: string
  kind: EventKind
  programme: string
  /** The call that opened or was announced; null for a new programme with no open or upcoming call. */
  call: string | null
}

/** The few fields the comparison reads from a programme file. */
export type Snapshot = Map<string, { calls: { id: string; status: string }[] }>

const live = (status: string) => status === 'open' || status === 'upcoming'
const kindFor = (status: string): EventKind => (status === 'open' ? 'opened' : 'announced')

/** The events between two snapshots, all dated `at`. */
export function diffSnapshots(before: Snapshot, after: Snapshot, at: string): DigestEvent[] {
  const events: DigestEvent[] = []
  for (const [id, p] of after) {
    const old = before.get(id)
    if (!old) {
      const call = p.calls.find((c) => c.status === 'open') ?? p.calls.find((c) => c.status === 'upcoming')
      events.push({ at, kind: 'new_programme', programme: id, call: call?.id ?? null })
      continue
    }
    const oldStatus = new Map(old.calls.map((c) => [c.id, c.status]))
    for (const c of p.calls) {
      const was = oldStatus.get(c.id)
      // A new call, or one whose status moved to open or upcoming. A call that opens again later is news again.
      if (!live(c.status) || was === c.status) continue
      events.push({ at, kind: kindFor(c.status), programme: id, call: c.id })
    }
  }
  return events
}
