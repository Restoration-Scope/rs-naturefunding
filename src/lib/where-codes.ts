// The codes a listing's place is matched by: data-where on the finder's rows, the country pages and the digest.
import type { Programme } from '../data/schema'
import { areaCountries, countryRegion } from './geo'
import { whereFit, type Fit } from './where-fit'

type Geography = Programme['geography']

/** The regions a `regions` geography takes whole; its other regions hold a group only the funder can settle. */
export const wholeRegions = (g: Extract<Geography, { scope: 'regions' }>) => (g.whole === true ? g.regions : (g.whole ?? []))

/**
 * `*` anywhere; `KE` a country; `r:africa` some of a region; `R:africa` all of it, but for `!NG`. A group the funder
 * names without a list ("Mediterranean basin") is `?:africa` and `?MA` for each country it may mean: check, never a yes.
 */
export function whereCodes(p: Pick<Programme, 'geography'>): string[] {
  const g = p.geography
  if (!g) return []
  if (g.scope === 'global') return ['*']
  if (g.scope === 'countries') {
    const regions = new Set(g.countries.map((c) => countryRegion[c]).filter(Boolean))
    return [...g.countries, ...[...regions].map((r) => `r:${r}`)]
  }
  const whole = wholeRegions(g)
  const out = new Set(g.except ?? [])
  const named = g.named ?? []
  const maybe = [...new Set((g.areas ?? []).flatMap(areaCountries))].filter((c) => !out.has(c) && !named.includes(c) && !whole.includes(countryRegion[c]!))
  return [
    ...named,
    ...whole.map((r) => `R:${r}`),
    ...g.regions.filter((r) => !whole.includes(r)).map((r) => `?:${r}`),
    ...maybe.map((c) => `?${c}`),
    ...(whole.length ? [...out].map((c) => `!${c}`) : []),
  ]
}

export const placeFit = (p: Pick<Programme, 'geography'>, where: string): Fit | null => whereFit(whereCodes(p), where, countryRegion[where])
