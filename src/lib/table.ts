import type { Programme } from '../data/schema'

/** Rough US dollars per unit, only to sort the Amount column. Amounts always show in the funder's currency. */
const usdPerUnit: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.13, CAD: 0.73, AUD: 0.66, NZD: 0.6, JPY: 0.0067, NOK: 0.093, SEK: 0.095,
  DKK: 0.145, BRL: 0.18, MXN: 0.055, INR: 0.012, ZAR: 0.055, KES: 0.0078, CNY: 0.14, SGD: 0.75, HKD: 0.13,
}

/** The largest stated figure in rough US dollars, for sorting. Null when there is no amount or no rate. */
export function usdValue(a: Programme['amount']): number | null {
  if (!a) return null
  const rate = usdPerUnit[a.currency]
  if (!rate) return null
  return Math.round((a.max ?? a.min ?? 0) * rate)
}

const short = (code: string, n: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: code,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    currencyDisplay: 'narrowSymbol',
  }).format(n)

/** "Up to $250k USD", "$1m–1.3m USD": the funder's figures, shortened for a table cell. The full text is the cell's title. */
export function compactAmount(a: Programme['amount']): string | null {
  if (!a) return null
  const code = a.currency
  const nb = '\u00a0'
  const per = a.per === 'year' ? ' a year' : ''
  if (a.min !== undefined && a.max !== undefined) {
    const u = a.typical ? 'Usually ' : ''
    if (a.min === a.max) return `${u}${short(code, a.max)}${nb}${code}${per}`
    const top = a.max_exclusive ? ` to less than ${short(code, a.max)}` : `–${short(code, a.max)}`
    return `${u}${short(code, a.min)}${top}${nb}${code}${per}`
  }
  if (a.max !== undefined) {
    const lead = a.max_exclusive ? 'less than' : 'up to'
    return `${a.typical ? `Usually ${lead}` : lead[0]!.toUpperCase() + lead.slice(1)} ${short(code, a.max)}${nb}${code}${per}`
  }
  return `${a.typical ? 'Usually from' : 'From'} ${short(code, a.min!)}${nb}${code}${per}`
}
