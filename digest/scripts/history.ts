// Reads the digest's events out of git: every commit on the first-parent line that touched data/programmes,
// compared with its parent. Runs at bundle time (a macro import in src/worker.ts) and in the preview script,
// from the repo root. CI needs the history, so the deploy checkout uses fetch-depth: 0.
import { diffSnapshots, type DigestEvent, type Snapshot } from '../src/events'

const DIR = 'data/programmes'

type Entry = { id: string; calls: { id: string; status: string }[] }

const git = (args: string[], input?: string) => {
  const r = Bun.spawnSync(['git', ...args], { stdin: input === undefined ? undefined : new TextEncoder().encode(input) })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`)
  return r.stdout
}

/** Blob id of each programme file at a commit. */
function tree(rev: string): Map<string, string> {
  const out = git(['ls-tree', rev, `${DIR}/`]).toString()
  return new Map(
    out
      .split('\n')
      .filter((l) => l.endsWith('.json'))
      .map((l) => {
        const [meta, path] = l.split('\t') as [string, string]
        return [path, meta.split(' ')[2]!]
      }),
  )
}

/** Reads blobs in one `git cat-file --batch`, parsing only the ids and call statuses. */
function readBlobs(ids: string[], cache: Map<string, Entry>) {
  const todo = [...new Set(ids)].filter((id) => !cache.has(id))
  if (todo.length === 0) return
  const buf = git(['cat-file', '--batch'], todo.join('\n') + '\n')
  let at = 0
  for (const id of todo) {
    const nl = buf.indexOf(10, at)
    const size = Number(buf.subarray(at, nl).toString().split(' ')[2])
    const body = JSON.parse(buf.subarray(nl + 1, nl + 1 + size).toString())
    cache.set(id, { id: body.id, calls: (body.calls ?? []).map((c: { id: string; status: string }) => ({ id: c.id, status: c.status })) })
    at = nl + 1 + size + 1
  }
}

/**
 * Events from commits since `sinceDays` ago (default a year, so a long pause in sending loses nothing), oldest first. Each commit is compared with its first
 * parent; a commit whose parent has no programmes yet (the seed) is the baseline and reports nothing, unless
 * `baseline` is set (the preview uses it to show a launch-week digest).
 */
export function eventsFromHistory(
  sinceDays = 365,
  until = 'HEAD',
  // DIGEST_BASELINE=1 at bundle time builds a local Worker that replays launch week (README: Sample digest).
  { baseline = process.env.DIGEST_BASELINE === '1' } = {},
): DigestEvent[] {
  const log = git(['log', '--first-parent', '--reverse', '--format=%H %P %cI', `--since=${sinceDays}.days`, until, '--', DIR])
    .toString()
    .trim()
  if (!log) return []
  const cache = new Map<string, Entry>()
  const snapshot = (rev: string): Snapshot => {
    const t = tree(rev)
    readBlobs([...t.values()], cache)
    return new Map([...t.values()].map((b) => [cache.get(b)!.id, cache.get(b)!]))
  }
  const events: DigestEvent[] = []
  let seeded = false
  for (const line of log.split('\n')) {
    const [sha, ...rest] = line.split(' ')
    const at = rest.pop()!
    const parent = rest[0]
    if (!parent) continue
    const before = snapshot(parent)
    // The commit that first brings the data in (the seed, or a merge of it) is the baseline, not news. Data that
    // comes back after a commit that emptied the folder is compared as usual.
    const isSeed = before.size === 0 && !seeded
    seeded = true
    if (isSeed && !baseline) continue
    events.push(...diffSnapshots(before, snapshot(sha!), new Date(at).toISOString()))
  }
  return events
}

/** When the newest commit in the bundle reached main: the digest has reported everything up to here. */
export const coveredUntil = (until = 'HEAD') => new Date(git(['log', '-1', '--first-parent', '--format=%cI', until]).toString().trim()).toISOString()
