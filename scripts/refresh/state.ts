/**
 * What the refresh job remembers between runs, in data/checks/ (never the page text):
 * - sources.json: the last fetch of each watched page, by source id (written on main every run).
 * - accepted/<id>.json: the hash of the page text whose facts are on main. A Tier B pull
 *   request changes it, so merging the PR is what accepts a changed page.
 * - run.json: counts from the last run; the site publishes it as /health.json.
 * - links.json: the weekly link-rot pass.
 * - programmes.json: per programme, whether every page it cites came back on the latest read,
 *   so the site can say "not re-checked since <date>" instead of passing an old date off as current.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Programme, Source } from '../../src/data/schema'
import type { FailureKind, Fetched } from './fetch'
import { formatJson } from './json'
import { dateOf, evidenceRefs } from './tier'

export const CHECKS_DIR = join(process.cwd(), 'data', 'checks')
export const SOURCES_PATH = join(CHECKS_DIR, 'sources.json')
export const acceptedPath = (id: string) => join(CHECKS_DIR, 'accepted', `${id}.json`)
export const RUN_PATH = join(CHECKS_DIR, 'run.json')
export const LINKS_PATH = join(CHECKS_DIR, 'links.json')
export const PROGRAMMES_PATH = join(CHECKS_DIR, 'programmes.json')

export type SourceState = {
  source_id: string
  url: string
  /** ISO time of the last attempt and of the last successful read. */
  last_attempt: string | null
  last_ok: string | null
  /** Date the page text last differed from the read before it. */
  last_change: string | null
  last_hash: string | null
  last_error: { at: string; kind: FailureKind; message: string } | null
  failures_in_row: number
}

export type SourceStates = Record<string, SourceState>

export type Accepted = { hash: string; accepted_at: string }

export type RunReport = {
  run_at: string
  run_url: string | null
  sources: { total: number; checked: number; unchanged: number; changed: number; failed: number; failing_3_plus: number }
  calls_closed: number
  programmes: { total: number; not_rechecked: number; stale_over_30_days: number }
}

/** The date stays the programme's checked_at, which only moves when every page it cites reads. */
export type ProgrammeCheck = {
  /** Why a page it cites failed its latest read (robots before blocked before the rest), or null when all read. */
  reason: FailureKind | null
  failing_sources: string[]
}

export type ProgrammeChecks = Record<string, ProgrammeCheck>

const REASON_ORDER: FailureKind[] = ['robots', 'blocked', 'http', 'network', 'timeout', 'selector', 'unreadable']

/** Per programme: is every source that watches it (by programme_id or by a cited URL) reading OK on its latest attempt? */
export function programmeChecks(programmes: Programme[], sources: Source[], states: SourceStates): ProgrammeChecks {
  const out: ProgrammeChecks = {}
  for (const p of [...programmes].sort((a, b) => a.id.localeCompare(b.id))) {
    const cited = new Set(evidenceRefs(p).map((r) => r.evidence.source_url))
    const failing = sources
      .filter((s) => s.programme_id === p.id || cited.has(s.url))
      .filter((s) => states[s.id]?.url === s.url && states[s.id]?.last_error)
    const kinds = new Set(failing.map((s) => states[s.id]!.last_error!.kind))
    out[p.id] = {
      reason: REASON_ORDER.find((k) => kinds.has(k)) ?? null,
      failing_sources: failing.map((s) => s.id).sort(),
    }
  }
  return out
}

export type LinkState = Record<string, { ok: boolean; status: string; checked_at: string; failures_in_row: number }>

export function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
}

/** Writes only when the content differs, so unchanged state makes no commit. */
export function writeJson(path: string, value: unknown): boolean {
  const next = formatJson(value)
  if (existsSync(path) && readFileSync(path, 'utf8') === next) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, next)
  return true
}

const CYCLE_DAYS = { daily: 0, weekly: 6.5, monthly: 29 } as const

export function isDue(source: Source, state: SourceState | null, now: Date): boolean {
  if (!state?.last_ok || state.url !== source.url) return true
  return now.getTime() - Date.parse(state.last_ok) >= CYCLE_DAYS[source.cycle] * 86_400_000
}

/** A failed read records the error and never moves `last_ok`. */
export function nextState(prev: SourceState | null, source: Source, read: Fetched, now: Date): SourceState {
  const at = now.toISOString()
  const base: SourceState = prev && prev.url === source.url
    ? { ...prev }
    : { source_id: source.id, url: source.url, last_attempt: null, last_ok: null, last_change: null, last_hash: null, last_error: null, failures_in_row: 0 }
  base.last_attempt = at
  if (!read.ok) {
    return { ...base, last_error: { at, kind: read.kind, message: read.message }, failures_in_row: base.failures_in_row + 1 }
  }
  const changed = base.last_hash !== null && base.last_hash !== read.hash
  return {
    ...base,
    last_ok: at,
    last_change: changed ? dateOf(now) : base.last_change,
    last_hash: read.hash,
    last_error: null,
    failures_in_row: 0,
  }
}
