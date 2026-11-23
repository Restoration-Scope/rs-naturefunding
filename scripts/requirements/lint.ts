/**
 * Code checks for the reviewer's recurring catches in "Before you apply" items: each finding is a lead for the
 * second reader, never a verdict. Scored against the reviewers' labels in tests/fixtures/review-labels/
 * (lint.test.ts): a check stays only while most of what it flags was wrong.
 */
import { comparable } from '../../src/data/text'

export type LintField = 'eligibility' | 'documents' | 'effort' | 'co_finance'
export type Check = 'restates_geography' | 'count_cap' | 'same_quote' | 'duplicate' | 'cost_exclusions' | 'not_english'
export type Finding = { field: LintField; index: number; item: string; check: Check; why: string }

/** The written items a check reads. `quote` lines up with `rule` for eligibility only. */
export type LintInput = {
  eligibility: { rule: string; quote?: string }[]
  documents: string[]
  steps: string[]
  applies_to?: string
  geography?: { scope: string; label?: string; countries?: string[] } | null
}

/** A programme file's items as a lint input. */
export function lintInput(p: Record<string, any>): LintInput {
  const quotes: any[] = p.evidence?.eligibility ?? []
  return {
    eligibility: (p.eligibility ?? []).map((e: any, i: number) => ({ rule: e.rule, quote: quotes[i]?.quote })),
    documents: p.documents ?? [],
    steps: p.effort?.steps ?? [],
    applies_to: p.co_finance?.applies_to,
    geography: p.geography ?? null,
  }
}

const wordsOf = (s: string) => comparable(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
// Words that say where without narrowing it, and the grammar around them.
const PLACE_GRAMMAR = new Set(
  'a an the be is are must its their his her our of to in on at by or and for with within inside into from located based situated operating operate operates take takes place places close near area areas region regions project projects organisation organisations organization organizations applicant applicants work works activity activities group groups only all whole entire served serves serve served'.split(' '),
)
const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** A rule that only says the place the listing's geography already holds ("Be located in British Columbia"). */
function restatesGeography(rule: string, g: LintInput['geography']): boolean {
  if (!g || !/\b(located|based|within|situated|in)\b/i.test(rule) || /\b(register|incorporat|charit|resident|citizen)/i.test(rule)) return false
  // The label when there is one ("British Columbia"), else the country names.
  const place = new Set((g.label ? wordsOf(g.label) : (g.countries ?? []).flatMap((c) => wordsOf(countryName(c)))).filter((w) => !PLACE_GRAMMAR.has(w)))
  const words = wordsOf(rule)
  const named = [...place].filter((w) => words.includes(w)).length
  const rest = words.filter((w) => !place.has(w) && !PLACE_GRAMMAR.has(w))
  // Names most of that place and little else.
  return place.size > 0 && named / place.size >= 0.6 && rest.length <= 1
}

const COST = /\b(costs?|salar(y|ies)|overheads?|operating|capital|endowments?|reimburs\w*|expenditure|deficits?|fundrais\w*|sponsorships?|purchases?|wages)\b/i
// Counted over a past period: "in the last 12 months", "received … previously", "in a 6-year period".
const PAST = /\b(had|received|made|previous(ly)?|already|in the (last|past)|(\d+|one|two|three|four|five|six)[- ]year period)\b/i
const COUNT_CAP = /\b(no more than|not more than|at most|a maximum of|up to)\s+(once|twice|(one|two|three|four|five|six|\d+)\s+(\w+\s+)?(times?|awards?|grants?|applications?|requests?|projects?|measures?))\b/i
const NEGATED = /\b(not?|non|excludes?|excluding|ineligible|only)\b/i
const NON_ENGLISH =
  /\b(und|für|oder|nicht|mit|zur|zum|der|des|del|los|las|para|con|por|una|les|pour|avec|sur|och|för|het|een|voor|dos|com|uit|naar)\b|\p{L}{4,}(ción|ções|ção|ungen|ung|keit|heit|ización|ität)\b/iu

export function lint(x: LintInput): Finding[] {
  const out: Finding[] = []
  const push = (field: LintField, index: number, item: string, check: Check, why: string) => out.push({ field, index, item, check, why })

  x.eligibility.forEach((e, i) => {
    if (restatesGeography(e.rule, x.geography))
      push('eligibility', i, e.rule, 'restates_geography', `only repeats the geography ("${x.geography?.label ?? x.geography?.countries?.join(', ')}"); keep a place rule only when it is stricter`)
    if (COUNT_CAP.test(e.rule) && PAST.test(e.rule))
      push('eligibility', i, e.rule, 'count_cap', 'a cap on past awards or applications: a Yes must still leave room for this one ("no more than 3 awards" lets a 4th in; "fewer than 3" does not)')
    const same = x.eligibility.findIndex((o, j) => j < i && ((o.quote && e.quote && comparable(o.quote) === comparable(e.quote)) || sameRule(o.rule, e.rule)))
    if (same >= 0)
      push('eligibility', i, e.rule, x.eligibility[same]!.quote && e.quote && comparable(x.eligibility[same]!.quote!) === comparable(e.quote) ? 'same_quote' : 'duplicate', `shares its quote or wording with rule ${same + 1}: one stated requirement is one rule, and either/or routes are one rule`)
  })
  const costs = x.eligibility.map((e, i) => ({ e, i })).filter(({ e }) => COST.test(e.rule) && NEGATED.test(e.rule))
  for (const { e, i } of costs.slice(1)) push('eligibility', i, e.rule, 'cost_exclusions', `cost exclusions are split over ${costs.length} rules; keep one rule for what the grant won't pay for, or none`)


  const texts: [LintField, number, string][] = [
    ...x.eligibility.map((e, i): [LintField, number, string] => ['eligibility', i, e.rule]),
    ...x.documents.map((d, i): [LintField, number, string] => ['documents', i, d]),
    ...x.steps.map((s, i): [LintField, number, string] => ['effort', i, s]),
    ...(x.applies_to ? [['co_finance', 0, x.applies_to] as [LintField, number, string]] : []),
  ]
  for (const [field, i, s] of texts) if (NON_ENGLISH.test(ownWords(s))) push(field, i, s, 'not_english', 'written in the funder\'s language; items are in English, quotes stay verbatim')
  return out
}

/** The text without names and glosses: parentheses go, and so do capitalised words after the first ("Fundación Unicaja"). */
const ownWords = (s: string) =>
  s
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((w, i) => i === 0 || !/\p{Lu}/u.test(w))
    .join(' ')

/** Two rules that say the same thing in nearly the same words. */
function sameRule(a: string, b: string) {
  const x = new Set(wordsOf(a).filter((w) => w.length > 2))
  const y = new Set(wordsOf(b).filter((w) => w.length > 2))
  if (!x.size || !y.size) return false
  // Different numbers or tracks ("Track A … EUR 50,000", "Track C … EUR 300,000") are different rules.
  const marks = (s: string) => (s.match(/\b(\d[\d.,]*|[A-Z])\b/g) ?? []).sort().join(' ')
  if (marks(a) !== marks(b)) return false
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / Math.max(x.size, y.size) >= 0.8
}
