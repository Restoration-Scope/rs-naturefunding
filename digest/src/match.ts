// A subscriber's saved filters, matched the way the finder matches its `where` and `approach` filters
// (src/lib/finder.ts), so the email lists what the finder would show for the same choice.
import type { Programme } from '../../src/data/schema'
import { countryRegion, regionLabels, countryName, type Region } from '../../src/lib/geo'
import { approachLabels } from '../../src/lib/labels'
import { usdPerUnit } from '../../src/lib/rates'
import { placeFit } from '../../src/lib/where-codes'

export type Approach = Programme['approaches'][number]

/** `where` is '' (anywhere), an ISO country code ("KE") or a region ("r:africa"), as in the finder's select. */
export type Prefs = { where: string; approaches: Approach[] }

const regions = Object.keys(regionLabels) as Region[]

/** Keeps only values the finder offers; anything else means "no filter". */
export function cleanPrefs(where: unknown, approaches: unknown): Prefs {
  const w = typeof where === 'string' ? where.trim() : ''
  const okWhere = (w.startsWith('r:') && regions.includes(w.slice(2) as Region)) || Object.hasOwn(countryRegion, w) ? w : ''
  const list = (Array.isArray(approaches) ? approaches : [approaches]).filter((a): a is string => typeof a === 'string')
  const okApproaches = [...new Set(list.filter((a) => Object.hasOwn(approachLabels, a)))] as Approach[]
  return { where: okWhere, approaches: okApproaches }
}

export function matches(p: Programme, prefs: Prefs): boolean {
  if (prefs.approaches.length > 0 && !p.approaches.some((a) => prefs.approaches.includes(a))) return false
  return placeFit(p, prefs.where) !== null
}

/** The currency amounts are shown in: one data/rates.json knows, else '' (each funder's own). */
export function cleanCurrency(c: unknown): string {
  return typeof c === 'string' && /^[A-Z]{3}$/.test(c) && Object.hasOwn(usdPerUnit, c) ? c : ''
}

/** "Kenya · Mangroves or Wetlands", or null for no filters. */
export function prefsText(prefs: Prefs): string | null {
  const where = !prefs.where ? null : prefs.where.startsWith('r:') ? regionLabels[prefs.where.slice(2) as Region] : countryName(prefs.where)
  const what = prefs.approaches.length ? prefs.approaches.map((a) => approachLabels[a]).join(' or ') : null
  const parts = [where, what].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
