// Builds the past issues from git history at site build time (src/pages/digest/). Each week is rendered with the
// data as it stood when it would have gone out, so a call that has closed since still shows as it was then. With no
// history (a shallow clone) there are none.
import { loadProgrammes } from '../../src/data/load'
import { buildDigest, type Digest } from '../src/digest'
import { issueWeeks } from '../src/issues'
import { commitAt, eventsFromHistory, programmesAt } from './history'

export type Issue = { date: string; since: string; until: string; digest: Digest }

let cache: Issue[] | undefined

export function pastIssues(now = new Date().toISOString()): Issue[] {
  if (cache) return cache
  let events: ReturnType<typeof eventsFromHistory>
  try {
    events = eventsFromHistory(365, 'HEAD', { baseline: false })
  } catch {
    return (cache = [])
  }
  const today = new Map(loadProgrammes().map((p) => [p.id, p]))
  cache = events.length === 0 ? [] : issueWeeks(events[0]!.at, now).flatMap((w) => {
    const rev = commitAt(w.until)
    if (!rev) return []
    const digest = buildDigest(events, programmesAt(rev, today), { where: '', approaches: [] }, w.since, w.until)
    return digest.total ? [{ ...w, digest }] : []
  })
  return cache
}
