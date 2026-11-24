// What a listing's `geography` may say about a place, so a country page never claims a grant for a country it doesn't take.
import { areaCountries, countryName, countryRegion, type Region } from '../lib/geo'
import { placeFit, wholeRegions } from '../lib/where-codes'
import type { CountryList, Programme } from './schema'

/** Words for a closed set the funder or a treaty lists: its countries go in `countries`, read from that list. */
const CLOSED = /overseas (countries|territor)|\bUKOTs?\b|\bOCTs?\b|outermost region|member states?\b|associated countr|ODA[- ]eligible|official development assistance|high[- ]income|(eligible|listed|following|participating|recipient) countr/i
/** Words for a place smaller than a region: "Southern Africa", "Mediterranean basin", "Caribbean". */
const NARROW = /\b(north|south|east|west|central)([ -]?(north|south|east|west|central))*(ern)?[ -]+(and [a-z-]+ )?(africa|asia|europe|america|pacific)|caribbean|mediterran|andes|andean|amazon|\bsea\b|\bocean\b|basin|islands?\b|coast|seaboard|flyway|sahar|sahel|oriental|melanesia|micronesia|polynesia|australasia|caucasus|neotropic(?!s? \()|polar|arctic|current\b|transfrontier|landscapes?\b|afrique/i
/** Words that pick countries out of a region. */
const GROUP = /developing|emerging|income|global south|mainly|mostly|varies|range countr|hotspot|\btropics\b|nations|biogeographical/i
/** How a funder's wording names each region whole. */
const REGION_WORDS: Record<Region, RegExp> = {
  africa: /africa/i,
  asia: /asia/i,
  europe: /europe/i,
  latin_america_caribbean: /latin america|neotropics|western hemisphere/i,
  middle_east: /middle east/i,
  north_america: /north america|western hemisphere/i,
  oceania: /oceania|asia-pacific region/i,
}
/** Words that leave out what they name. */
const EXCLUDES = /\b(except|excluding|excludes|other than|outside)\b|not eligible/i
/** Words that close a set on the countries around them. */
const ONLY = /\b(only|limited to|restricted to|must be in)\b/i
const aliases: Record<string, string[]> = { GB: ['UK', 'Britain'], US: ['USA', 'US', 'U.S.'], CD: ['DRC'], AE: ['UAE'] }
/** The countries a text names. */
const namedIn = (text: string) => {
  const found: string[] = []
  let rest = text
  // Longest first, so "Papua New Guinea" isn't read as Guinea.
  const names = Object.keys(countryRegion).flatMap((c) => [countryName(c), ...(aliases[c] ?? [])].map((n) => [n, c] as const))
  for (const [n, c] of names.sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`(?<!\\p{L})${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'gu')
    if (!re.test(rest)) continue
    found.push(c)
    rest = rest.replace(re, ' ')
  }
  return found
}
/** "Latin America and the Caribbean" and "North America" are regions of ours; what follows in brackets explains. */
const bare = (s: string) => s.replace(/latin america(?: and |, )(?:the )?caribbean|the caribbean, latin america|north america|middle east/gi, '').replace(/neotropics \(.*\)|related islands/i, '')

/** A text without its words for smaller places, so "Southern Africa" no longer names Africa. */
const unnarrowed = (s: string) => {
  const regions = s.replace(/latin america|north america|middle east|neotropics/gi, (m) => ({ latin: 'LATIN_AMERICA', north: 'NORTH_AMERICA', middle: 'MIDDLE_EAST', neotropics: 'LATIN_AMERICA' })[m.toLowerCase().split(' ')[0]!]!)
  return regions.replace(new RegExp(NARROW.source, 'gi'), ' ').replace(/_/g, ' ')
}

export function geographyIssues(p: Pick<Programme, 'geography' | 'evidence'>, lists?: ReadonlyMap<string, CountryList>): string[] {
  const g = p.geography
  const issues: string[] = []
  const quotes = [p.evidence.geography ?? [], p.evidence.places ?? []].flat().map((e) => e.quote).join(' ')
  const say = (s: string) => issues.push(`geography: ${s}`)
  if (g?.scope === 'countries') {
    // A programme that points to an official list holds every country on it, so the page never misses one.
    for (const id of lists ? [g.list ?? []].flat() : []) {
      const list = lists!.get(id)
      const missing = list?.countries.filter((c) => !g.countries.includes(c)) ?? []
      if (!list) say(`list ${id} is not in data/lists`)
      else if (missing.length) say(`countries lacks ${missing.join(', ')} from ${list.name}`)
    }
    // …and no country the list lacks, unless the funder's own words name it.
    const listed = lists && g.list ? [g.list].flat().flatMap((id) => lists.get(id)?.countries ?? []) : null
    const words = listed ? namedIn(quotes) : []
    const extra = listed ? g.countries.filter((c) => !listed.includes(c) && !words.includes(c)) : []
    if (extra.length) say(`countries adds ${extra.join(', ')}, not on its list and not named in the quotes`)
    const strays = Object.keys(g.parts ?? {}).filter((c) => !g.countries.includes(c))
    if (strays.length) say(`parts names ${strays.join(', ')}, not in countries`)
  }
  if (g?.scope !== 'regions') return issues

  const whole = wholeRegions(g)
  const areas = g.areas ?? []
  const spans = new Set([...areas.flatMap(areaCountries), ...(g.named ?? [])].map((c) => countryRegion[c]))
  if (areas.some((a) => areaCountries(a).some((c) => !countryRegion[c]))) say('areas holds a code that is not a country we list')
  for (const r of whole) if (!g.regions.includes(r)) say(`whole names ${r}, not in regions`)
  for (const r of g.regions) if (!whole.includes(r) && !spans.has(r)) say(`say whether the funder takes all of ${r} (whole) or where in it its group can be (areas)`)
  for (const r of spans) if (r && !g.regions.includes(r)) say(`areas reaches ${r}, not in regions`)

  const words = `${g.label}. ${quotes}`
  const spelled = namedIn(words)
  const unnamed = (g.named ?? []).filter((c) => !spelled.includes(c))
  if (unnamed.length) say(`named holds ${unnamed.join(', ')}, which the label and quotes don't name`)
  const closed = CLOSED.exec(words.replace(/\b(not|no)\b[^.]*\blist\b[^.]*/gi, ''))
  const only = words.split(/[.;]\s/).find((s) => ONLY.test(s) && !EXCLUDES.test(s) && namedIn(s).length > 1)
  if (only) say(`“${only.trim()}” closes a set of countries: use scope countries`)
  if (EXCLUDES.test(words)) for (const c of spelled) if (!g.named?.includes(c) && placeFit(p, c) === 'all') say(`the words leave out some countries and name ${c}: put it in except, or in named if the funder takes it`)
  if (closed) say(`“${closed[0]}” is a set of countries someone lists: use scope countries, read from that list`)
  const exclusion = /except|outside/i.test(g.label)
  for (const r of whole) if (!exclusion && !REGION_WORDS[r].test(unnarrowed(g.label))) say(`whole claims all of ${r}, which the label doesn't name`)
    else if (REGION_WORDS[r].test(quotes) && !REGION_WORDS[r].test(unnarrowed(quotes))) say(`whole claims all of ${r}, but the quote names only a part of it`)
  if (g.whole === true && (GROUP.test(g.label) || NARROW.test(bare(g.label)))) say('whole claims every country, but the label names a group or a smaller place: use areas')
  // Without this, "Mediterranean basin" mapped to africa shows on Kenya's page.
  if (!g.whole && !g.except && NARROW.test(bare(g.label)) && areas.some((a) => g.regions.includes(a as Region) && !REGION_WORDS[a as Region].test(unnarrowed(g.label))))
    say('the label names a place smaller than a region: name it in areas (src/lib/geo.ts), not the whole region')
  return issues
}
