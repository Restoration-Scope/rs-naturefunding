import type { Programme } from '../data/schema'
import { countryName, regionLabels } from './geo'

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
