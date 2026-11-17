/**
 * Typed values on eligibility rules (years operating, a revenue or budget range, a request capped by revenue)
 * and the checks that tie each to its own rule's quote. A value a visitor's answers can be tested against greys a
 * grant out, so a wrong one costs more than a missing one: the schema refuses a value its quote doesn't state, and
 * the requirements pipeline drops it and keeps the rule as text.
 */
import { normalise } from './text'

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20,
  twice: 2, half: 0.5,
  // es, pt, it
  uno: 1, una: 1, um: 1, uma: 1, dos: 2, dois: 2, duas: 2, due: 2, tres: 3, três: 3, tre: 3, cuatro: 4, quatro: 4, quattro: 4,
  cinco: 5, cinque: 5, seis: 6, sei: 6, diez: 10, dez: 10, dieci: 10,
  // fr
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10,
  // de, nl
  ein: 1, eine: 1, einem: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, zehn: 10, één: 1, een: 1, twee: 2, drie: 3, vijf: 5, tien: 10,
}

const SCALE: Record<string, number> = {
  k: 1e3, thousand: 1e3, mil: 1e3, tausend: 1e3, mille: 1e3, duizend: 1e3,
  m: 1e6, mn: 1e6, million: 1e6, millions: 1e6, millones: 1e6, millón: 1e6, millon: 1e6, milhões: 1e6, milhão: 1e6, mio: 1e6, millionen: 1e6, miljoen: 1e6,
}

/**
 * Every number a quote states: digits with any thousands separator ("60,000", "60.000", "60 000", "60'000"),
 * a scale word after them ("60k", "1.5 million", "2 Mio."), and small numbers written as words ("three", "drei").
 */
export function numbersIn(quote: string): Set<number> {
  const text = normalise(quote).toLowerCase()
  const found = new Set<number>()
  const re = /(\d{1,3}(?:([,.' ])\d{3}(?:\2\d{3})*)|\d+)(?:[.,](\d+))?\s*(k|thousand|tausend|mille|mil|duizend|mn|m|millions?|millones|mill[oó]n|milh(?:ões|ão)|mio|millionen|miljoen)?\.?(?![\p{L}])/giu
  for (const m of text.matchAll(re)) {
    const whole = Number(m[1]!.replace(/[,.' ]/g, ''))
    const frac = m[3] ? Number(`0.${m[3]}`) : 0
    // "1,5" or "1.5": a decimal part; "60,000": thousands, already folded into whole.
    const n = whole + frac
    // "EUR 1 million" states 1,000,000, not 1.
    found.add(m[4] ? n * SCALE[m[4].toLowerCase()]! : n)
  }
  for (const w of text.split(/[^\p{L}]+/u)) if (w in WORDS) found.add(WORDS[w]!)
  return found
}

const states = (quote: string, n: number) => numbersIn(quote).has(n)

const YEAR = String.raw`(?:years?|yrs?|jahre?n?|años?|anos?|ans?|année?s?|jaar|jaren|anni|anno|år|vuotta|vuoden|lat|let|年)`
const MONTH = String.raw`(?:months?|monate?n?|meses|mois|maanden|mesi|månader|måneder|kuukautta|か月|ヶ月|カ月)`

/** The numbers a quote puts right before a unit word ("3 years", "three full years", "1 年以上"), so "36 years" is never 36 months. */
function numbersBefore(quote: string, unit: string): Set<number> {
  const text = normalise(quote).toLowerCase()
  const out = new Set<number>()
  const named = Object.keys(WORDS).sort((x, y) => y.length - x.length).join('|')
  const num = String.raw`(\d+(?:[.,]\d+)?|${named})`
  const re = new RegExp(String.raw`(?<![\p{L}\d])${num}(?:\s*\(\d+\))?\s*(?:[\p{L}-]+\s+){0,2}?${unit}(?![a-zäöüéèàçñ])`, 'giu')
  for (const m of text.matchAll(re)) {
    const raw = m[1]!
    const n = /^\d/.test(raw) ? Number(raw.replace(',', '.')) : WORDS[raw]
    if (n !== undefined && Number.isFinite(n)) out.add(n)
  }
  return out
}

/** Whether a quote states this many years operating: as years ("3 years", "three years") or as months ("36 months"). */
export const statesYears = (quote: string, years: number) => numbersBefore(quote, YEAR).has(years) || numbersBefore(quote, MONTH).has(Math.round(years * 12))

const SYMBOLS: Record<string, RegExp> = {
  EUR: /€|\beuros?\b/i,
  GBP: /£|\bpounds?\b/i,
  USD: /(?<![A-Za-z])(?:US)?\$|\bdollars?\b/i,
  CAD: /(?:C|CA|CDN)?\$|\bdollars?\b/i,
  AUD: /(?:A|AU)?\$|\bdollars?\b/i,
  NZD: /(?:NZ)?\$|\bdollars?\b/i,
  JPY: /¥|円|\byen\b/i,
  CHF: /\bfr\.|\bfrancs?\b|\bfranken\b/i,
  SEK: /\bkr\b|\bkronor\b/i,
  NOK: /\bkr\b|\bkroner\b/i,
  DKK: /\bkr\b|\bkroner\b/i,
  INR: /₹|\brupees?\b/i,
  BRL: /R\$|\breais\b/i,
}

/** Whether a quote names this currency: its ISO code, or a symbol or word that can mean it ("€", "$" for any dollar). */
export const statesCurrency = (quote: string, code: string) =>
  new RegExp(String.raw`\b${code}\b`, 'i').test(quote) || (SYMBOLS[code]?.test(normalise(quote)) ?? false)

const BASE_WORDS =
  /revenue|income|turnover|budget|expenditure|spending|umsatz|einnahmen|jahresbudget|ingresos|presupuesto|facturaci[oó]n|chiffre d'affaires|recettes|revenus|receita|or[çc]amento|faturamento|omzet|begroting|inkomsten|fatturato|bilancio|entrate/i

/** A request held to at most the applicant's own money: "must not exceed", "no more than", "up to". */
const CAPS = /exceed|no more than|not more than|greater than|larger than|higher than|up to|at most|maximum|überschreiten|nicht mehr als|höchstens|superar|exceder|no más de|dépasser|pas plus de|ultrapassar|niet meer dan|overschrijden|superare|non più di|上回らない|以内/i

/** Whether a quote compares the request with the applicant's own money (revenue, income, turnover, budget). */
export const namesOwnMoney = (quote: string) => BASE_WORDS.test(normalise(quote))

/** A revenue or budget range the applicant must fall in, per year. */
export type RevenueRange = { currency: string; min?: number; max?: number; basis: 'revenue' | 'budget' | 'expenditure'; average_years?: number }
/** The largest request as a share of the applicant's yearly revenue or budget, in percent (100 = one year's revenue). */
export type RequestCap = { share: number; of: 'revenue' | 'budget' }
export type Thresholds = { min_years?: number; revenue?: RevenueRange; request_cap?: RequestCap }

/** Why a rule's typed values don't follow from its quote, one reason per value; empty when each is stated. */
export function thresholdProblems(t: Thresholds, quote: string): { key: keyof Thresholds; why: string }[] {
  const out: { key: keyof Thresholds; why: string }[] = []
  if (t.min_years !== undefined && !statesYears(quote, t.min_years)) {
    out.push({ key: 'min_years', why: `the rule's quote does not state ${t.min_years} years (or ${Math.round(t.min_years * 12)} months)` })
  }
  const r = t.revenue
  if (r) {
    const missing = [r.min, r.max].filter((n): n is number => n !== undefined && !states(quote, n))
    if (r.average_years !== undefined && !numbersBefore(quote, YEAR).has(r.average_years)) missing.push(r.average_years)
    if (missing.length) out.push({ key: 'revenue', why: `the rule's quote does not state ${missing.join(', ')}` })
    else if (!statesCurrency(quote, r.currency)) out.push({ key: 'revenue', why: `the rule's quote does not name ${r.currency}` })
    else if (!namesOwnMoney(quote)) out.push({ key: 'revenue', why: 'the rule’s quote does not name revenue, income or a budget' })
  }
  const c = t.request_cap
  if (c) {
    if (!namesOwnMoney(quote)) out.push({ key: 'request_cap', why: 'the rule’s quote does not compare the request with revenue or a budget' })
    // A whole year's revenue needs the quote to compare the request with it; any other share needs its number.
    else if (c.share === 100 ? !(states(quote, 100) || CAPS.test(normalise(quote))) : !states(quote, c.share) && !states(quote, c.share / 100)) {
      out.push({ key: 'request_cap', why: c.share === 100 ? 'the rule’s quote does not say the request may not exceed the revenue or budget' : `the rule's quote does not state ${c.share}%` })
    }
  }
  return out
}
