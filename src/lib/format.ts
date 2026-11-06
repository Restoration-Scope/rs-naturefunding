import type { Programme } from '../data/schema'
import { countryName, regionLabels } from './geo'
import { usdPerUnit } from './rates'

// Dates are calendar days: read them in UTC so no time zone moves them a day.
const fmt = (month: 'short' | 'long') => new Intl.DateTimeFormat('en-US', { month, day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const short = fmt('short')
const long = fmt('long')

/** Nov 1, 2026 */
export const shortDate = (iso: string) => short.format(new Date(`${iso}T00:00:00Z`))
/** November 1, 2026 */
export const longDate = (iso: string) => long.format(new Date(`${iso}T00:00:00Z`))

const money = (currency: string, n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0, currencyDisplay: 'narrowSymbol' })
    .format(n)

export function amountText(a: Programme['amount']): string | null {
  if (!a) return null
  const code = a.currency
  // A typical range is what the funder usually gives, not a limit.
  const usually = a.typical ? 'Usually ' : ''
  const per = a.per === 'year' ? ' a year' : ''
  if (a.min !== undefined && a.max !== undefined) {
    if (a.min === a.max) return `${usually}${money(code, a.max)} ${code}${per}`
    // "Less than" leaves the max out, so the range reads "… to less than …".
    const top = a.max_exclusive ? `less than ${money(code, a.max)}` : money(code, a.max)
    return `${usually}${money(code, a.min)} to ${top} ${code}${per}`
  }
  if (a.max !== undefined) {
    const lead = a.max_exclusive ? 'less than' : 'up to'
    return `${a.typical ? `Usually ${lead}` : lead[0]!.toUpperCase() + lead.slice(1)} ${money(code, a.max)} ${code}${per}`
  }
  return `${a.typical ? 'Usually from' : 'From'} ${money(code, a.min!)} ${code}${per}`
}

/** A figure with its currency code, once: "€17,000,000 EUR", but "BTN 6,000,000" where the symbol is the code. */
const moneyWithCode = (currency: string, n: number) => {
  const m = money(currency, n)
  return m.includes(currency) ? m : `${m} ${currency}`
}

/** "up to €17,000,000 EUR for the 2026 Blue Carbon call": what all grants share, never one grant. */
export function poolText(p: Programme['pool']): string | null {
  if (!p) return null
  const lead = p.qualifier === 'up_to' ? 'up to ' : p.qualifier === 'about' ? 'about ' : ''
  const when = p.label
    ? `for ${p.label}`
    : p.period === 'year' ? 'a year' : p.period === 'biennium' ? 'per biennium' : p.period === 'programme' ? 'over the programme' : 'for the round'
  return `${lead}${moneyWithCode(p.currency, p.value)} ${when}${p.qualifier === 'planned' ? ' (planned, not final)' : ''}`
}

export function geographyText(g: Programme['geography']): string | null {
  if (!g) return null
  if (g.scope === 'global') return 'Worldwide'
  if (g.scope === 'regions') return g.label
  // The funder's own wording already names the place; the full country list is on the programme page.
  if (g.label) return g.label
  const names = g.countries.map(countryName)
  return names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : joinAnd(names)
}

export function geographyFull(g: Programme['geography']): string | null {
  if (!g) return null
  if (g.scope === 'global') return 'Worldwide'
  if (g.scope === 'regions') {
    const regions = joinAnd(g.regions.map((r) => regionLabels[r]))
    return regions === g.label ? regions : `${g.label} (${regions})`
  }
  const list = joinAnd(g.countries.map(countryName))
  return g.label ? `${g.label}: ${list}` : list
}

export const joinAnd = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`

/** "$5K", "€20M", "CA$7.5K": the sign where the currency has one, else its code ("CZK 50K"). */
const compact = (currency: string, n: number, digits: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumSignificantDigits: digits }).format(n).replace(/\s/, ' ')
const compactBare = (n: number, digits: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: digits }).format(n)

/** "$5K–$15K", "CZK 50K–200K", "Up to £3K", "From €50K": the figures alone, with no "per project". */
function shortRange(a: NonNullable<Programme['amount']>, currency: string, factor: number, digits: number, about = false): string {
  const f = (n: number) => compact(currency, n * factor, digits)
  const ab = about ? 'about ' : ''
  if (a.min !== undefined && a.max !== undefined) {
    if (a.min === a.max) return `${ab}${f(a.max)}`
    if (a.max_exclusive) return `${ab}${f(a.min)} to under ${f(a.max)}`
    // A code (not a sign) is written once: "CZK 50K–200K".
    const low = f(a.min)
    const top = /^[A-Z]{3} /.test(low) ? compactBare(a.max * factor, digits) : f(a.max)
    return `${ab}${low}–${top}`
  }
  if (a.max !== undefined) return `${a.max_exclusive ? 'under' : 'up to'} ${ab}${f(a.max)}`
  return `from ${ab}${f(a.min!)}`
}

const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/**
 * An amount for a quick read, per project: "Usually $5K–$15K per project". With `currency` set to another
 * currency than the funder's, the figures are converted at data/rates.json ("About $5.6M–$22M per project") and
 * `original` keeps the funder's own ("€5M–€20M"), for showing muted beside it.
 */
export function amountShort(a: Programme['amount'], currency?: string): { text: string; original: string | null } | null {
  if (!a) return null
  const to = currency && currency !== a.currency && usdPerUnit[currency] && usdPerUnit[a.currency] ? currency : null
  const figures = to ? shortRange(a, to, usdPerUnit[a.currency]! / usdPerUnit[to]!, 2, true) : shortRange(a, a.currency, 1, 3)
  const text = `${a.typical ? `Usually ${figures}` : capital(figures)} per project${a.per === 'year' ? ' a year' : ''}`
  return { text, original: to ? capital(shortRange(a, a.currency, 1, 3)) : null }
}

/** A note shown as a sentence: adds the full stop unless it already ends in one. */
export const sentence = (text: string) => (/[.!?…]["”’)]?$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/** example.org/coastal-trust/grants, for "Checked against …" lines. */
/** For display: an amount never breaks between a figure and its currency code. */
export function keepAmountTogether(text: string): string {
  return text.replace(/ ([A-Z]{3})\b/g, '\u00a0$1')
}

/** "https://www.cepf.net/grants/life-cycle-of-grant" → "cepf.net · life cycle of grant": the site, then the page's last path segment in words. */
export function pageLabel(url: string): string {
  const u = new URL(url)
  const host = u.hostname.replace(/^www\./, '')
  const last = u.pathname.split('/').filter(Boolean).pop()
  if (!last) return host
  let page = last
  try {
    page = decodeURIComponent(last)
  } catch {}
  page = page.replace(/\.(html?|php|aspx?|pdf)$/i, (ext) => (ext.toLowerCase() === '.pdf' ? ' (PDF)' : '')).replace(/[-_+]+/g, ' ').trim()
  if (page.length > 48) page = `${page.slice(0, 46).trimEnd()}…`
  return page ? `${host} · ${page}` : host
}

/** "2 steps to apply" for a finder row; "2+" when the page says more follow. Null when not stated. */
export function effortShort(e: Programme['effort']): string | null {
  if (!e) return null
  const n = e.steps.length + (e.more_after ? 1 : 0)
  return `${n}${e.more_after ? '+' : ''} step${n === 1 ? '' : 's'} to apply`
}

/** The steps in order, as the listing page shows them. */
export function effortText(e: Programme['effort']): string | null {
  if (!e) return null
  return [...e.steps, ...(e.more_after ? ['further steps'] : [])].join(' → ')
}
