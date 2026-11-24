import type { z } from 'zod'
import type { region as regionSchema } from '../data/schema'

export type Region = z.infer<typeof regionSchema>

export const regionLabels: Record<Region, string> = {
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  latin_america_caribbean: 'Latin America and the Caribbean',
  middle_east: 'Middle East',
  north_america: 'North America',
  oceania: 'Oceania',
}

const members: Record<Region, string> = {
  africa:
    'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW',
  asia:
    'AF BD BT BN KH CN HK IN ID JP KZ KG LA MO MY MV MN MM NP KP KR PK PH SG LK TW TJ TH TL TM UZ VN',
  europe:
    'AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FO FI FR GE DE GI GR GL HU IS IE IM IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA AX GG JE',
  latin_america_caribbean:
    'AI AG AR AW BS BB BZ BM BO BQ BR VG KY CL CO CR CU CW DM DO EC SV FK GF GD GP GT GY HT HN JM MQ MX MS NI PA PY PE PR BL KN LC MF PM VC SX SR TT TC UY VE VI',
  middle_east: 'BH IR IQ IL JO KW LB OM PS QA SA SY TR AE YE',
  north_america: 'CA US',
  oceania: 'AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF',
}

export const countryRegion: Record<string, Region> = Object.fromEntries(
  (Object.entries(members) as [Region, string][]).flatMap(([r, codes]) => codes.split(' ').map((c) => [c, r])),
)

const names = new Intl.DisplayNames(['en'], { type: 'region' })
/** Names that differ between ICU builds (Bun says "China mainland", Node "China"); pinned so tests and build agree. */
const pinned: Record<string, string> = { CN: 'China' }
export const countryName = (iso2: string) => pinned[iso2] ?? names.of(iso2) ?? iso2

/**
 * The same area words as a group of countries, to leave out of "check" the countries a funder's wording can't mean.
 * Each is the widest reading of the words. Ours, for matching only: never shown, never a yes (src/lib/where-codes.ts).
 */
const areaMembers = {
  southeast_asia: 'BN KH ID LA MY MM PH SG TH TL VN',
  oriental: 'BD BN BT CN HK ID IN KH KR JP LA LK MM MN MO MV MY NP PH PK SG TH TL TW VN',
  caribbean:
    'AG AI AW BB BL BM BQ BS BZ CO CR CU CW DM DO GD GF GP GT GY HN HT JM KN KY LC MF MQ MS MX NI PA PR SR SX TC TT VC VE VG VI',
  insular_caribbean: 'AG AI AW BB BL BM BQ BS CU CW DM DO GD GP HT JM KN KY LC MF MQ MS PR SX TC TT VC VG VI',
  central_america: 'BZ CR GT HN MX NI PA SV',
  south_america: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  tropical_andes: 'AR BO CL CO EC PE VE',
  mediterranean_basin:
    'AL BA BG CY DZ EG ES FR GI GR HR IL IQ IT JO LB LY MA MC ME MK MT PS PT RS SI SM SY TN TR XK',
  north_baltic_seas: 'AX BE DE DK EE FI FR GB LT LV NL NO PL RU SE',
  polar: 'CA DK FI FO GL IS NO RU SE SJ US',
  sub_saharan_africa:
    'AO BF BI BJ BW CD CF CG CI CM CV DJ ER ET GA GH GM GN GQ GW KE KM LR LS MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TZ UG YT ZA ZM ZW',
  west_central_africa: 'AO BF BI BJ CD CF CG CI CM CV GA GH GM GN GQ GW LR ML MR NE NG RW SH SL SN ST TD TG',
  /** https://www.un.org/ohrlls/content/list-ldcs, with the three leaving on 24 November 2026. */
  least_developed_countries:
    'AF AO BD BF BI BJ CD CF DJ ER ET GM GN GW HT KH KI KM LA LR LS MG ML MM MR MW MZ NE NP RW SB SD SL SN SO SS TD TG TL TV TZ UG YE ZM',
  melanesia: 'FJ ID NC PG SB TL VU',
  pacific_islands: 'AS CK FJ FM GU KI MH MP NC NF NR NU PF PG PN PW SB TK TO TV VU WF WS',
  australasia: 'AU FJ ID NC NF NZ PG SB TL VU',
} as const
export type Area = Region | keyof typeof areaMembers
export const areaNames = [...(Object.keys(members) as Region[]), ...(Object.keys(areaMembers) as (keyof typeof areaMembers)[])] as const
/** The countries an area of `geography.areas` can mean: a region, a named area, or one country's own code. */
export const areaCountries = (a: string): string[] =>
  a in members ? members[a as Region].split(' ') : a in areaMembers ? areaMembers[a as keyof typeof areaMembers].split(' ') : [a]

/** Countries grouped by region, sorted by name, for the "Where" select. */
export const countriesByRegion = (Object.keys(members) as Region[]).map((r) => ({
  region: r,
  label: regionLabels[r],
  countries: members[r]
    .split(' ')
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
}))
