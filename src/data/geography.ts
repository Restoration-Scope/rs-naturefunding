// What a listing's `geography` may say about a place, so a country page never claims a grant for a country it doesn't take.
import { areaCountries, countryRegion, type Region } from '../lib/geo'
import { wholeRegions } from '../lib/where-codes'
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
  latin_america_caribbean: /latin america|neotropics/i,
  middle_east: /middle east/i,
  north_america: /north america/i,
  oceania: /oceania|asia-pacific region/i,
}
/** "Latin America and the Caribbean" and "North America" are regions of ours; what follows in brackets explains. */
const bare = (s: string) => s.replace(/latin america(?: and |, )(?:the )?caribbean|the caribbean, latin america|north america|middle east/gi, '').replace(/neotropics \(.*\)|related islands/i, '')

export function geographyIssues(p: Pick<Programme, 'geography' | 'evidence'>, lists?: ReadonlyMap<string, CountryList>): string[] {
  const g = p.geography
  const issues: string[] = []
  const say = (s: string) => issues.push(`geography: ${s}`)
  if (g?.scope === 'countries') {
    // A programme that points to an official list holds every country on it, so the page never misses one.
    for (const id of lists ? [g.list ?? []].flat() : []) {
      const list = lists!.get(id)
      const missing = list?.countries.filter((c) => !g.countries.includes(c)) ?? []
      if (!list) say(`list ${id} is not in data/lists`)
      else if (missing.length) say(`countries lacks ${missing.join(', ')} from ${list.name}`)
    }
    const strays = Object.keys(g.parts ?? {}).filter((c) => !g.countries.includes(c))
    if (strays.length) say(`parts names ${strays.join(', ')}, not in countries`)
  }
  if (g?.scope !== 'regions') return issues

  const quotes = [p.evidence.geography ?? [], p.evidence.places ?? []].flat().map((e) => e.quote).join(' ')
  const whole = wholeRegions(g)
  const areas = g.areas ?? []
  const spans = new Set(areas.flatMap(areaCountries).map((c) => countryRegion[c]))
  if (areas.some((a) => areaCountries(a).some((c) => !countryRegion[c]))) say('areas holds a code that is not a country we list')
  for (const r of whole) if (!g.regions.includes(r)) say(`whole names ${r}, not in regions`)
  for (const r of g.regions) if (!whole.includes(r) && !spans.has(r)) say(`say whether the funder takes all of ${r} (whole) or where in it its group can be (areas)`)
  for (const r of spans) if (r && !g.regions.includes(r)) say(`areas reaches ${r}, not in regions`)

  const closed = CLOSED.exec(`${g.label} ${quotes}`)
  if (closed) say(`“${closed[0]}” is a set of countries someone lists: use scope countries, read from that list`)
  const exclusion = /except|outside/i.test(g.label)
  for (const r of whole) if (!exclusion && !REGION_WORDS[r].test(g.label)) say(`whole claims all of ${r}, which the label doesn't name`)
  if (g.whole === true && (GROUP.test(g.label) || NARROW.test(bare(g.label)))) say('whole claims every country, but the label names a group or a smaller place: use areas')
  // Without this, "Mediterranean basin" mapped to africa shows on Kenya's page.
  if (!g.whole && !g.except && NARROW.test(bare(g.label)) && areas.every((a) => g.regions.includes(a as Region)))
    say('the label names a place smaller than a region: name it in areas (src/lib/geo.ts), not the whole region')
  return issues
}
