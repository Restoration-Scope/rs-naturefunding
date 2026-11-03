// Pages that are the finder with Where or the project type already set: one per country with enough
// programmes, one per region and one per project type. Each holds only its own rows, so search engines index
// a page per place and per type; the other filters stay in the address (src/lib/finder.ts).
import type { Listing } from './data'
import { listings, sortListings, whereCodes } from './data'
import { countryName, countryRegion, regionLabels, type Region } from './geo'
import { approachLabels, projectTypes } from './labels'
import { pageKey, type PagePaths } from './page-paths'

/** A country gets its own page once this many programmes name it. */
const MIN_NAMED = 5

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Whether a programme takes projects in a Where value, as the finder's Where filter decides it. */
export function matchesWhere(p: Listing['p'], where: string) {
  if (!where) return true
  const codes = whereCodes(p).split(' ')
  if (codes.includes('*')) return true
  if (where.startsWith('r:')) return codes.includes(where) || codes.includes(`R:${where.slice(2)}`)
  return codes.includes(where) || codes.includes(`R:${countryRegion[where]}`)
}

// The project types as the finder's tabs hold them: only approaches some listing has.
const used = new Set(listings.flatMap((l) => l.p.approaches))
export const types = projectTypes
  .map((t) => ({ ...t, approaches: t.approaches.filter((a) => used.has(a)) }))
  .filter((t) => t.approaches.length)
  .map((t) => ({ ...t, cat: [...t.approaches].sort().join(' ') }))

/** What each type's page is about, finishing "Grants for …". */
const typeTopics: Record<string, string> = {
  forests: 'forest restoration and tree planting',
  coasts: 'coastal and marine conservation',
  wetlands: 'wetland, peatland and river restoration',
  grasslands: 'grassland restoration',
  wildlife: 'wildlife conservation and protected areas',
  communities: 'community-led conservation',
  cities: 'urban nature',
  research: 'conservation research',
}

export type FinderPage = {
  path: string
  where: string
  cat: string
  iso2?: string
  name: string
  h1: string
  title: string
  lead: string
  listings: Listing[]
}

const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
const openNow = (ls: Listing[]) => {
  // Open with a deadline or an undated window, as the home page and the Open now toggle count it; rolling apart.
  const n = ls.filter((l) => l.state === 'open').length
  return `${n} ${n === 1 ? 'is' : 'are'} open now.`
}
const programmes = (n: number) => plural(n, 'grant or funding programme takes', 'grants and funding programmes take')

function placePage(where: string, path: string, name: string, regionName: string, iso2?: string): FinderPage {
  const ls = listings.filter((l) => matchesWhere(l.p, where)).sort(sortListings)
  const codes = (l: Listing) => whereCodes(l.p).split(' ')
  const global = ls.filter((l) => codes(l).includes('*')).length
  const region = ls.filter((l) => codes(l).some((c) => c.startsWith('R:'))).length
  const named = ls.length - global - region
  const namedText = iso2 ? `${named} name ${name}` : `${named} name countries in ${name}`
  return {
    path,
    where,
    cat: '',
    iso2,
    name,
    h1: `Grants for nature restoration and conservation in ${name}`,
    title: `Grants for NGOs in ${name}: restoration and conservation funding`,
    lead: `${programmes(ls.length)} nature restoration and conservation projects in ${name}: ${namedText}, ${region} cover all of ${regionName} and ${global} are open worldwide. ${openNow(ls)}`,
    listings: ls,
  }
}

const namedCount = (iso2: string) =>
  listings.filter((l) => l.p.geography?.scope === 'countries' && l.p.geography.countries.includes(iso2)).length

const countryPages = Object.keys(countryRegion)
  .filter((c) => namedCount(c) >= MIN_NAMED)
  .sort((a, b) => countryName(a).localeCompare(countryName(b)))
  .map((c) => placePage(c, `/countries/${slug(countryName(c))}/`, countryName(c), regionLabels[countryRegion[c]!], c))

const regionPages = (Object.entries(regionLabels) as [Region, string][]).map(([r, label]) =>
  placePage(`r:${r}`, `/regions/${slug(label)}/`, label, label),
)

const typePages = types.map((t): FinderPage => {
  const ls = listings.filter((l) => l.p.approaches.some((a) => t.approaches.includes(a))).sort(sortListings)
  const topic = typeTopics[t.key] ?? t.approaches.map((a) => approachLabels[a].toLowerCase()).join(', ')
  return {
    path: `/types/${t.key}/`,
    where: '',
    cat: t.cat,
    name: t.label,
    h1: `Grants for ${topic}`,
    title: `Grants for ${topic}`,
    lead: `${programmes(ls.length)} ${topic} projects. ${openNow(ls)}`,
    listings: ls,
  }
})

export const finderPages = { countries: countryPages, regions: regionPages, types: typePages }

/** Every preset's page, for the finder script and the type tabs' links. */
export const pagePaths: PagePaths = Object.fromEntries([
  [pageKey('', ''), '/'],
  ...[...countryPages, ...regionPages, ...typePages].map((p) => [pageKey(p.where, p.cat), p.path]),
])

/** The place pages a programme shows on, its countries' first and then their regions, and its type pages. */
export function pagesFor(p: Listing['p']): { places: FinderPage[]; types: FinderPage[] } {
  const g = p.geography
  const countries = g?.scope === 'countries' ? g.countries : []
  // A long country list reads better as its regions.
  const own = countries.length <= 6 ? countryPages.filter((pg) => countries.includes(pg.iso2!)) : []
  const regions = new Set(g?.scope === 'regions' ? g.regions.map((r) => `r:${r}`) : countries.map((c) => `r:${countryRegion[c]}`))
  return {
    places: [...own, ...regionPages.filter((pg) => regions.has(pg.where))],
    types: typePages.filter((pg) => p.approaches.some((a) => pg.cat.split(' ').includes(a))),
  }
}
