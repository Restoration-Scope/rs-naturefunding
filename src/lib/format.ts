import type { Programme } from '../data/schema'
import { countryName, regionLabels } from './geo'

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number]

/** 1 Nov 2026. Spelled out by hand: en-GB's "Sept" reads oddly next to every other month. */
export const shortDate = (iso: string) => {
  const [y, m, d] = parts(iso)
  return `${d} ${months[m - 1]} ${y}`
}
/** 1 November 2026 */
export const longDate = (iso: string) => {
  const [y, m, d] = parts(iso)
  return `${d} ${longMonths[m - 1]} ${y}`
}

const money = (currency: string, n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0, currencyDisplay: 'narrowSymbol' })
    .format(n)

export function amountText(a: Programme['amount']): string | null {
  if (!a) return null
  const code = a.currency
  // A typical range is what the funder usually gives, not a limit.
  const usually = a.typical ? 'Usually ' : ''
  if (a.min !== undefined && a.max !== undefined) {
    return a.min === a.max
      ? `${usually}${money(code, a.max)} ${code}`
      : `${usually}${money(code, a.min)} to ${money(code, a.max)} ${code}`
  }
  if (a.max !== undefined) return a.typical ? `Usually up to ${money(code, a.max)} ${code}` : `Up to ${money(code, a.max)} ${code}`
  return a.typical ? `Usually from ${money(code, a.min!)} ${code}` : `From ${money(code, a.min!)} ${code}`
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
  if (g.scope === 'regions') return `${g.label} (${joinAnd(g.regions.map((r) => regionLabels[r]))})`
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
