import type { Programme } from '../data/schema'
import { usdPerUnit } from './rates'

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
