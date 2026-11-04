/**
 * Saves today's exchange rates to data/rates.json, so the site converts amounts at build time
 * with no request from the reader's browser. Run it with the daily refresh.
 * Source: ExchangeRate-API's free open feed (attribution required: shown on the calculator).
 */
import { writeFileSync } from 'fs'
import { join } from 'path'

const SOURCE = 'https://open.er-api.com/v6/latest/USD'
const res = await fetch(SOURCE)
if (!res.ok) throw new Error(`rates: ${res.status} from ${SOURCE}`)
const body = (await res.json()) as { result: string; time_last_update_unix: number; rates: Record<string, number> }
if (body.result !== 'success' || !body.rates?.EUR) throw new Error('rates: unexpected response')

const per_usd = Object.fromEntries(
  Object.entries(body.rates)
    .filter(([code, r]) => /^[A-Z]{3}$/.test(code) && r > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, r]) => [code, Number(r.toPrecision(6))]),
)
const out = {
  source: 'ExchangeRate-API',
  source_url: 'https://www.exchangerate-api.com',
  date: new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10),
  /** Units of each currency per US dollar. */
  per_usd,
}
writeFileSync(join(import.meta.dir, '../../data/rates.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`rates: ${Object.keys(per_usd).length} currencies as of ${out.date}`)
