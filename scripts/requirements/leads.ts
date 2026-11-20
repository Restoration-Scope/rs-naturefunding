/**
 * Leads the requirements reading left for a person: a rules document the text names that we never read, an
 * application page on another site we don't read, a field the models couldn't settle. None is a fact (AGENTS.md:
 * never infer); each is a place to look. The weekly summary issue shows the first of them; this prints them all.
 *   bun scripts/requirements/leads.ts [--md]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Programme } from '../../src/data/schema'
import type { Manifest } from './write'

/** How pipeline.ts words a rules document the text names and we didn't read; a second reading prefixes it. */
export const UNREAD_DOC = 'the text names a document with rules that was not read: '

export type Lead = { id: string; status: string; unread: string[]; offsite: string[]; unresolved: string[] }

const RANK: Record<string, number> = { open: 0, upcoming: 1, unknown: 2, suspended: 3, closed: 4, none: 5 }

/** One lead per programme with anything to look at, open and upcoming calls first, then the most to look at. */
export function leadsOf(manifests: Pick<Manifest, 'id' | 'reasons' | 'failures' | 'outcomes'>[], programmes: Pick<Programme, 'id' | 'calls'>[]): Lead[] {
  const byId = new Map(programmes.map((p) => [p.id, p]))
  const out: Lead[] = []
  for (const m of manifests) {
    const p = byId.get(m.id)
    // A manifest left behind by a programme since removed is nobody's lead.
    if (!p) continue
    const unread = [...new Set(m.reasons.filter((r) => r.includes(UNREAD_DOC)).map((r) => r.slice(r.indexOf(UNREAD_DOC) + UNREAD_DOC.length).trim()))]
    // Failures repeat once per page that links them.
    const offsite = [...new Set(m.failures.filter((f) => f.kind === 'offsite').map((f) => f.url))]
    const unresolved = Object.entries(m.outcomes).filter(([, o]) => o === 'unresolved').map(([f]) => f)
    if (!unread.length && !offsite.length && !unresolved.length) continue
    const status = p.calls.map((c) => c.status).sort((a, b) => RANK[a]! - RANK[b]!)[0] ?? 'none'
    out.push({ id: m.id, status, unread, offsite, unresolved })
  }
  const size = (l: Lead) => l.unread.length + l.offsite.length + l.unresolved.length
  return out.sort((a, b) => RANK[a.status]! - RANK[b.status]! || size(b) - size(a) || a.id.localeCompare(b.id))
}

/** A lead as one Markdown line; `all` lists every item, otherwise the first few and how many more. */
export function leadLine(l: Lead, all = false): string {
  const some = (xs: string[], n: number) => (all || xs.length <= n ? xs : [...xs.slice(0, n), `+${xs.length - n} more`])
  const parts = [
    l.unread.length ? `names unread: ${some(l.unread.map((n) => `"${n.slice(0, 80)}"`), 3).join(', ')}` : '',
    l.offsite.length ? `another site: ${some(l.offsite.map((u) => u.slice(0, 120)), 2).join(' ')}` : '',
    l.unresolved.length ? `unresolved: ${l.unresolved.join(', ')}` : '',
  ].filter(Boolean)
  return `- \`${l.id}\` (${l.status}): ${parts.join('; ')}`
}

/** The weekly issue's section: counts, then the first `limit` leads. An issue body holds at most 65,536 characters. */
export function leadsSection(leads: Lead[], limit = 40): string[] {
  const count = (k: 'unread' | 'offsite' | 'unresolved') => leads.filter((l) => l[k].length).length
  return [
    '### Requirements leads to look at',
    `${leads.length} programmes: ${count('unread')} name a rules document we haven't read, ${count('offsite')} link an application page on another site we don't read, ${count('unresolved')} have a field the models couldn't settle. None is a fact; each is a place to look. Open and upcoming calls first${leads.length > limit ? `; the first ${limit} below, all with \`bun scripts/requirements/leads.ts\`` : ''}.`,
    '',
    ...(leads.length ? leads.slice(0, limit).map((l) => leadLine(l)) : ['None.']),
  ]
}

export function readManifests(dir = join('data', 'requirements')): Manifest[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Manifest)
    .filter((m) => Array.isArray(m.reasons) && Array.isArray(m.failures) && !!m.outcomes)
}

if (import.meta.main) {
  const { loadData } = await import('../../src/data/load')
  const leads = leadsOf(readManifests(), loadData().programmes)
  console.log((process.argv.includes('--md') ? leadsSection(leads, Infinity) : leads.map((l) => leadLine(l, true))).join('\n'))
}
