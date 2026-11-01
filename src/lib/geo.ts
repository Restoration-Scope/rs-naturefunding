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
export const countryName = (iso2: string) => names.of(iso2) ?? iso2

/** Countries grouped by region, sorted by name, for the "Where" select. */
export const countriesByRegion = (Object.keys(members) as Region[]).map((r) => ({
  region: r,
  label: regionLabels[r],
  countries: members[r]
    .split(' ')
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
}))
