import type { Listing } from './data'
import { listings, sortListings } from './data'
import { countryName, countryRegion, regionLabels } from './geo'

/** Countries with their own page. Draft: Kenya only, while the page's look is reviewed. */
export const COUNTRY_PAGES = ['KE']

export const countrySlug = (iso2: string) =>
  countryName(iso2)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** How a listing reaches a country: the funder names it, covers its whole region, or funds anywhere. */
export type Reach = 'named' | 'region' | 'global'

export function reachOf(l: Listing, iso2: string): Reach | null {
  const g = l.p.geography
  if (!g) return null
  if (g.scope === 'global') return 'global'
  if (g.scope === 'regions') return g.regions.includes(countryRegion[iso2]!) ? 'region' : null
  return g.countries.includes(iso2) ? 'named' : null
}

/** Every listing open to projects in the country, grouped by how it reaches it, each group open calls first. */
export function countryListings(iso2: string) {
  const groups: Record<Reach, Listing[]> = { named: [], region: [], global: [] }
  for (const l of listings) {
    const r = reachOf(l, iso2)
    if (r) groups[r].push(l)
  }
  for (const g of Object.values(groups)) g.sort(sortListings)
  const all = [...groups.named, ...groups.region, ...groups.global]
  return {
    name: countryName(iso2),
    region: regionLabels[countryRegion[iso2]!],
    groups,
    all,
    open: all.filter((l) => l.state === 'open' || l.state === 'rolling').length,
  }
}
