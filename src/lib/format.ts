import type { Programme } from '../data/schema'
import { countryName, regionLabels } from './geo'
import { usdPerUnit } from './rates'

// Dates are calendar days: read them in UTC so no time zone moves them a day.
const fmt = (month: 'short' | 'long') => new Intl.DateTimeFormat('en-US', { month, day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const short = fmt('short')
const long = fmt('long')

/** True when the funder's name already starts with the programme's ("Scottish Rivers Fund" from "Scottish Rivers Fund"). */
export const funderRepeatsName = (p: Pick<Programme, 'name' | 'funder'>) =>
  p.funder.name.toLowerCase().startsWith(p.name.toLowerCase())

/** "Darwin Initiative Main, Defra", or the funder's name alone when it already says the programme's. */
export const nameWithFunder = (p: Pick<Programme, 'name' | 'funder'>) =>
  funderRepeatsName(p) ? p.funder.name : `${p.name}, ${p.funder.name}`

/** Longest title, before " · naturefunding.org", that search results usually show whole. */
const TITLE_MAX = 60
/** Words that name no one: a programme called only these ("Conservation Grants") needs its funder beside it. */
const GENERIC = new Set(
  'a an and the of for in on to grant grants fund funds funding program programme programs programmes project projects small large micro community communities conservation environment environmental nature biodiversity wildlife habitat restoration climate annual open call capacity scheme award awards support'.split(' '),
)
const isGeneric = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).every((w) => GENERIC.has(w))

/**
 * A programme page's title, for search results: the name, then what it pays ("Darwin Initiative Main, Defra: £200K–£1M"),
 * keeping the funder (its own short form where it gives one) where it fits, and always where the name alone is generic.
 */
export function programmeTitle(p: Pick<Programme, 'name' | 'funder' | 'amount'>): string {
  const acronym = p.funder.name.match(/\(([A-Z][A-Za-z0-9]{1,9})\)/)?.[1]
  const plain = p.funder.name.replace(/\s*\(.*\)\s*$/, '')
  const funder = acronym ?? plain
  const named =
    funderRepeatsName(p) || p.name.toLowerCase().includes(plain.toLowerCase()) || (acronym !== undefined && p.name.includes(acronym))
  const name = funderRepeatsName(p) ? plain : p.name
  const withFunder = named ? name : `${name}, ${funder}`
  const short = amountShort(p.amount)?.text.replace(/ per project/, '')
  const amount = short?.replace(/^(Up|Usually|From|Under) /, (w) => w.toLowerCase())
  const options = [
    amount && `${withFunder}: ${amount}`,
    amount && (named || !isGeneric(name)) && `${name}: ${amount}`,
    withFunder,
  ].filter((t): t is string => !!t)
  return options.find((t) => t.length <= TITLE_MAX) ?? (named || !isGeneric(name) ? name : withFunder)
}

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
  // Where the symbol is the code itself (BTN 1,000,000), the code isn't added again.
  const c = money(code, 1).includes(code) ? '' : ` ${code}`
  // A typical range is what the funder usually gives, not a limit.
  const usually = a.typical ? 'Usually ' : ''
  const per = `${a.unit ? ` per ${a.unit}` : ''}${a.per === 'year' ? ' a year' : ''}`
  if (a.min !== undefined && a.max !== undefined) {
    if (a.min === a.max) return `${usually}${money(code, a.max)}${c}${per}`
    // "Less than" leaves the max out, so the range reads "… to less than …".
    const top = a.max_exclusive ? `less than ${money(code, a.max)}` : money(code, a.max)
    return `${usually}${money(code, a.min)} to ${top}${c}${per}`
  }
  if (a.max !== undefined) {
    const lead = a.max_exclusive ? 'less than' : 'up to'
    return `${a.typical ? `Usually ${lead}` : lead[0]!.toUpperCase() + lead.slice(1)} ${money(code, a.max)}${c}${per}`
  }
  return `${a.typical ? 'Usually from' : 'From'} ${money(code, a.min!)}${c}${per}`
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
 * An amount for a quick read, per project (or per tree or hectare when the funder pays by the unit): "Usually $5K–$15K per project". With `currency` set to another
 * currency than the funder's, the figures are converted at data/rates.json ("About $5.6M–$22M per project") and
 * `original` keeps the funder's own ("€5M–€20M"), for showing muted beside it.
 */
export function amountShort(a: Programme['amount'], currency?: string): { text: string; original: string | null } | null {
  if (!a) return null
  const to = currency && currency !== a.currency && usdPerUnit[currency] && usdPerUnit[a.currency] ? currency : null
  const figures = to ? shortRange(a, to, usdPerUnit[a.currency]! / usdPerUnit[to]!, 2, true) : shortRange(a, a.currency, 1, 3)
  const text = `${a.typical ? `Usually ${figures}` : capital(figures)} per ${a.unit ?? 'project'}${a.per === 'year' ? ' a year' : ''}`
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

/**
 * How heavy applying is, as our label from counts the funder's pages give: Heavy at 3+ steps or 5+ documents,
 * Light at one step with at most 2 documents, Medium between. Null when the steps aren't stated.
 */
export function effortLevel(p: Pick<Programme, 'effort' | 'documents'>): { level: 'Light' | 'Medium' | 'Heavy'; why: string } | null {
  if (!p.effort) return null
  const steps = p.effort.steps.length + (p.effort.more_after ? 1 : 0)
  const docs = p.documents?.length
  const level = steps >= 3 || (docs ?? 0) >= 5 ? 'Heavy' : steps === 1 && (docs ?? 0) <= 2 ? 'Light' : 'Medium'
  const parts = [`${steps}${p.effort.more_after ? '+' : ''} ${steps === 1 ? 'step' : 'steps'}`, docs ? `${docs} ${docs === 1 ? 'document' : 'documents'}` : 'documents not listed']
  return { level, why: parts.join(', ') }
}

export type SignalLevel = 'light' | 'some' | 'heavy' | 'unstated' | 'unchecked'
export type Signal = { key: 'qualify' | 'apply' | 'cofund' | 'after'; label: string; level: SignalLevel; why: string }

const signalBlank = (p: Pick<Programme, 'requirements_checked'>): Pick<Signal, 'level' | 'why'> =>
  p.requirements_checked ? { level: 'unstated', why: 'The funder’s pages don’t say.' } : { level: 'unchecked', why: 'Not checked yet.' }
const listOf = (parts: string[]) => parts.join(', ').replace(/, ([^,]*)$/, ' and $1')

/**
 * What applying and holding the grant ask of an organisation, as four signals the finder shows as bars. Each
 * level comes from structured facts by fixed rules, so every grant is judged the same way:
 * - qualify: heavy with a finances rule (a financial bar to meet); some with a track-record or capacity rule
 *   or a required consortium; light with only legal, project or other rules.
 * - apply: effortLevel (Light, Medium, Heavy).
 * - cofund: light when none is required; heavy above 25% of the project; some otherwise. Accepting in-kind
 *   doesn't lower it: the page rarely says how much of the match may be in kind.
 * - after: heavy with quarterly reports or an audit; light with one final report and nothing else; some
 *   otherwise.
 * Absent facts read "unchecked" until requirements_checked is set, then "unstated": never light.
 */
export function effortSignals(
  p: Pick<Programme, 'eligibility' | 'effort' | 'documents' | 'co_finance_required' | 'co_finance' | 'consortium_required' | 'after_award' | 'requirements_checked'>,
): Signal[] {
  const rules = p.eligibility ?? []
  const count = `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`
  const bars = [...new Set(rules.map((e) => e.kind).filter((k) => k in kindWords))].map((k) => kindWords[k]!)
  const consortium = p.consortium_required ? ['a consortium'] : []
  const demands = [...(bars.length ? [`${listOf(bars)} requirements`] : []), ...consortium].join(' and ')
  const qualify: Pick<Signal, 'level' | 'why'> =
    rules.length || consortium.length
      ? {
          level: rules.some((e) => e.kind === 'finances') ? 'heavy' : bars.length || consortium.length ? 'some' : 'light',
          why: `${rules.length ? count : 'No listed rules'}${demands ? `, with ${demands}` : ', none on track record, capacity or finances'}.`,
        }
      : signalBlank(p)

  const lvl = effortLevel(p)
  const apply: Pick<Signal, 'level' | 'why'> = lvl
    ? { level: lvl.level === 'Light' ? 'light' : lvl.level === 'Medium' ? 'some' : 'heavy', why: `${lvl.level}: ${lvl.why}.` }
    : signalBlank(p)

  const c = p.co_finance
  const [mine, theirs] = (c?.ratio ?? '').split(':').map(Number)
  // A stated ratio is the exact figure; its share only sets the level. The schema allows one or the other.
  const share = mine && theirs ? (100 * mine) / (mine + theirs) : c?.min_share
  const parts = [
    ...(c?.ratio ? [`${mine} of yours for every ${theirs} from the funder`] : c?.min_share !== undefined ? [`at least ${c.min_share}% of the project`] : []),
    ...(c?.min_amount ? [`at least ${c.min_amount.value.toLocaleString('en')} ${c.min_amount.currency}`] : []),
  ]
  const cofund: Pick<Signal, 'level' | 'why'> =
    p.co_finance_required === false
      ? { level: 'light', why: 'None required.' }
      : p.co_finance_required === true
        ? {
            level: share !== undefined && share > 25 ? 'heavy' : 'some',
            why: `${parts.length ? listOf(parts).replace(/^./, (x) => x.toUpperCase()) : 'Required, amount not stated'}${c?.in_kind ? ', in-kind accepted' : ''}${c?.applies_to ? ` (${c.applies_to})` : ''}.`,
          }
        : signalBlank(p)

  const a = p.after_award
  const duties = a ? [...(a.audit ? ['an audit'] : []), ...(a.site_visits ? ['site visits'] : []), ...(a.training ? ['required training or events'] : [])] : []
  const reportWords = a?.reports ? reportLabels[a.reports] : 'reporting not stated'
  const after: Pick<Signal, 'level' | 'why'> = a
    ? {
        level: a.reports === 'quarterly' || a.audit ? 'heavy' : a.reports === 'final' && !duties.length ? 'light' : 'some',
        why: `${listOf([reportWords, ...duties]).replace(/^./, (x) => x.toUpperCase())}.`,
      }
    : signalBlank(p)

  return [
    { key: 'qualify', label: 'Who qualifies', ...qualify },
    { key: 'apply', label: 'Applying', ...apply },
    { key: 'cofund', label: 'Co-funding', ...cofund },
    { key: 'after', label: 'After the award', ...after },
  ]
}
const kindWords: Record<string, string> = { track_record: 'track-record', capacity: 'capacity', finances: 'finances' }
const reportLabels = {
  final: 'one final report',
  interim_and_final: 'interim and final reports',
  yearly: 'yearly reports',
  twice_yearly: 'reports twice a year',
  quarterly: 'quarterly or more frequent reports',
  other: 'reports on a set schedule',
  unspecified: 'reports, how often not stated',
} as const

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** A sum of money or a share in text: "€5,000,000", "EUR 2 - 4 million", "Nu. 6.0 million", "25%", "17,000,000 EUR". */
const figure =
  /(?:\b[A-Z]{3}\s?|Nu\.\s?|[€$£¥₹])?\d[\d,.]*(?:\s?[-–]\s?\d[\d,.]*)?(?:\s?(?:million|billion|bn|m|k)\b)?%?(?:\s[A-Z]{3}\b)?/g
/** Text as HTML with each figure in bold, so the numbers stand out in the money facts. A bare year stays plain. */
export function boldFigures(text: string): string {
  return escapeHtml(text).replace(figure, (m) => (/^(19|20)\d\d$/.test(m) ? m : `<strong class="font-bold text-ink">${m}</strong>`))
}
