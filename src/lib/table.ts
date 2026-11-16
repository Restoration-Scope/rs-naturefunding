import type { Programme } from '../data/schema'
import { usdPerUnit } from './rates'

/** The largest stated figure in rough US dollars, for sorting. Null when there is no amount or no rate. */
export function usdValue(a: Programme['amount']): number | null {
  if (!a) return null
  const rate = usdPerUnit[a.currency]
  if (!rate) return null
  return Math.round((a.max ?? a.min ?? 0) * rate)
}

/** "$250k", "€1.3m": compact, with the currency's narrow sign. A converted figure keeps two significant digits. */
const short = (code: string, n: number, converted = false) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: code,
    notation: 'compact',
    ...(converted ? { maximumSignificantDigits: 2 } : { minimumFractionDigits: 0, maximumFractionDigits: 1 }),
    currencyDisplay: 'narrowSymbol',
  }).format(n)

type Amount = NonNullable<Programme['amount']>

/** The figures in `code`, each times `factor`; "about" before them when converted. `bare`: the figures alone, no lead words. */
function phrase(a: Amount, code: string, factor = 1, bare = false): string {
  const converted = factor !== 1
  const fig = (n: number) => short(code, n * factor, converted)
  const ab = converted ? 'about ' : ''
  let s: string
  if (bare) {
    const xs = [a.min, a.max].filter((n) => n !== undefined)
    return `${xs[0] === xs[1] ? fig(xs[0]!) : xs.map(fig).join('–')} ${code}${a.unit ? ` per ${a.unit}` : ''}${a.per === 'year' ? ' a year' : ''}`
  }
  if (a.min !== undefined && a.max !== undefined) {
    if (a.min === a.max) s = `${ab}${fig(a.max)}`
    else s = `${ab}${fig(a.min)}${a.max_exclusive ? ` to less than ${fig(a.max)}` : `–${fig(a.max)}`}`
  } else if (a.max !== undefined) s = `${a.max_exclusive ? 'less than' : 'up to'} ${ab}${fig(a.max)}`
  else s = `from ${ab}${fig(a.min!)}`
  const unit = a.unit ? ` per ${a.unit}` : ''
  s = `${a.typical ? 'Usually ' : ''}${s} ${code}${unit}${a.per === 'year' ? ' a year' : ''}`
  return s[0]!.toUpperCase() + s.slice(1)
}

/** "Up to $250k USD", "$1m–1.3m USD": the funder's figures, shortened for a table cell. The full text is the cell's title. */
export function compactAmount(a: Programme['amount']): string | null {
  return a ? phrase(a, a.currency) : null
}

/** For a table cell: a range never breaks at its dash; the line may break before the currency code instead. */
const forCell = (s: string) => s.replace(/–/g, '–⁠').replace(/ ([A-Z]{3})/, ' $1')

/**
 * The amount cell's text in the reader's currency `to` ("Usually about $290k–$930k USD"), with the funder's own
 * figures as `original` ("€250k–€800k EUR", no lead words: the converted text already has them) when it was
 * converted. Same currency, no `to`, or no rate: the funder's figure alone. Rates from data/rates.json, as in the
 * weekly email (src/lib/format.ts amountShort).
 */
export function amountCell(a: Programme['amount'], to?: string): { text: string; original: string | null } | null {
  if (!a) return null
  const from = usdPerUnit[a.currency]
  const into = to ? usdPerUnit[to] : undefined
  if (!to || to === a.currency || !from || !into) return { text: forCell(phrase(a, a.currency)), original: null }
  return { text: forCell(phrase(a, to, from / into)), original: forCell(phrase(a, a.currency, 1, true)) }
}

/** Only the fields amountCell reads, for a row's data attribute. */
export const amountData = (a: Programme['amount']) =>
  a ? JSON.stringify({ currency: a.currency, min: a.min, max: a.max, typical: a.typical, max_exclusive: a.max_exclusive, per: a.per, unit: a.unit }) : undefined
