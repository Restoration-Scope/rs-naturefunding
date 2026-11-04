/**
 * Saves today's exchange rates to data/rates.json, so the site converts amounts at build time
 * with no request from the reader's browser. Run it with the daily refresh.
 * Source: ExchangeRate-API's free open feed (attribution required: shown on the calculator).
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs'
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
// Every currency a listing uses must have a rate, or the calculator can't convert it: keep yesterday's file.
const dir = join(import.meta.dir, '../../data/programmes')
const needed = new Set(['USD'])
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(dir, f), 'utf8')).amount?.currency
  if (c) needed.add(c)
}
const missing = [...needed].filter((c) => !(Number.isFinite(per_usd[c]) && per_usd[c] > 0))
if (missing.length) throw new Error(`rates: no rate for ${missing.join(', ')}; keeping the previous file`)
const out = {
  source: 'ExchangeRate-API',
  source_url: 'https://www.exchangerate-api.com',
  date: new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10),
  /** Units of each currency per US dollar. */
  per_usd,
}
writeFileSync(join(import.meta.dir, '../../data/rates.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`rates: ${Object.keys(per_usd).length} currencies as of ${out.date}`)
