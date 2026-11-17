/**
 * Stage 1, queue: which direct programmes need their requirements read, and why, open and upcoming calls
 * first. Due: never read; a watched page changed since the last read (the refresh's last_change); a read
 * older than 12 months. A programme read in the last 30 days with fields left unresolved waits for an
 * agent or a person instead of being reread.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Programme, Source } from '../../src/data/schema'
import type { Manifest } from './write'

export const MANIFEST_DIR = join(process.cwd(), 'data', 'requirements')
export const manifestPath = (id: string) => join(MANIFEST_DIR, `${id}.json`)
export const readManifest = (id: string): Manifest | null => (existsSync(manifestPath(id)) ? (JSON.parse(readFileSync(manifestPath(id), 'utf8')) as Manifest) : null)

type SourceState = { source_id: string; last_change: string | null }

export type Due = { id: string; why: string; rank: number }

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000

export function queue(programmes: Programme[], sources: Source[], states: Record<string, SourceState>, today: string, opts: { exclude?: Set<string> } = {}): Due[] {
  const out: Due[] = []
  for (const p of programmes) {
    if (p.access !== 'direct' || opts.exclude?.has(p.id)) continue
    const m = readManifest(p.id)
    const last = p.requirements_checked ?? m?.read_on ?? null
    const changed = sources
      .filter((s) => s.programme_id === p.id)
      .map((s) => states[s.id]?.last_change)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1)
    let why: string | null = null
    if (!last) why = 'never read'
    else if (changed && changed > last) why = `a watched page changed on ${changed}`
    else if (daysBetween(last, today) > 365) why = `last read on ${last}`
    else if (!p.requirements_checked && m && daysBetween(m.read_on, today) > 30) why = `read on ${m.read_on} with fields left open`
    if (!why) continue
    const live = p.calls.some((c) => c.status === 'open' || c.status === 'upcoming')
    out.push({ id: p.id, why, rank: (live ? 0 : 2) + (why === 'never read' ? 0 : 1) })
  }
  return out.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
}
