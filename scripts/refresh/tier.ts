/**
 * The refresh decisions, kept pure so they can be tested without a network:
 * - Tier A (auto-commit): the page text is the one last accepted and every quote that
 *   cites it is still there, so its facts get today's date. A call whose stated deadline
 *   has passed closes. No next round is ever made up.
 * - Tier B (pull request): the page changed or a quote is gone; facts are re-read.
 */
import type { Call, Evidence, Programme } from '../../src/data/schema'
import { comparable, quoteOnPage } from '../../src/data/text'
import { deadlinePassed } from './deadline'

export type QuoteRef = { programme_id: string; path: string; quote: string }

export const dateOf = (now: Date) => now.toISOString().slice(0, 10)

/** Every evidence of a programme with a readable path, e.g. `evidence.amount` or `calls[rolling].evidence.status`. */
export function evidenceRefs(p: Programme): { path: string; evidence: Evidence }[] {
  const refs = Object.entries(p.evidence).flatMap(([field, e]) => (e ? [{ path: `evidence.${field}`, evidence: e }] : []))
  for (const c of p.calls) {
    for (const [field, e] of Object.entries(c.evidence)) if (e) refs.push({ path: `calls[${c.id}].evidence.${field}`, evidence: e })
  }
  return refs
}

export function quotesAt(programmes: Programme[], url: string): QuoteRef[] {
  return programmes.flatMap((p) =>
    evidenceRefs(p)
      .filter((r) => r.evidence.source_url === url)
      .map((r) => ({ programme_id: p.id, path: r.path, quote: r.evidence.quote })),
  )
}

export type Tier = { tier: 'A'; baseline: boolean } | { tier: 'B'; reasons: string[] }

const site = (url: string) => new URL(url).hostname.replace(/^www\./, '')

/**
 * `accepted` is the hash of the page text whose facts are on main; null before the first read.
 * A page that redirected to another site goes to review, even with its quotes present.
 */
export function classify(page: { hash: string; text: string; url?: string; finalUrl?: string }, accepted: string | null, quotes: QuoteRef[]): Tier {
  const text = comparable(page.text)
  const reasons: string[] = []
  if (page.url && page.finalUrl && site(page.finalUrl) !== site(page.url)) reasons.push(`redirected to another site: ${page.finalUrl}`)
  if (accepted !== null && accepted !== page.hash) reasons.push('page text changed since the last accepted read')
  for (const q of quotes) {
    if (!quoteOnPage(text, q.quote)) reasons.push(`quote gone (${q.programme_id} ${q.path}): "${q.quote}"`)
  }
  return reasons.length ? { tier: 'B', reasons } : { tier: 'A', baseline: accepted === null }
}

const isLive = (c: Call) => c.status === 'open' || c.status === 'upcoming'

export type TierAResult = { programme: Programme; changed: boolean; closed: string[]; opened: string[] }

/**
 * Dates the facts read today on unchanged pages (`okUrls`), closes every call past its stated
 * deadline and opens upcoming calls whose stated opening date has come. The programme's own
 * `checked_at` follows its oldest fact, so it only moves when every fact was read again.
 */
export function applyTierA(original: Programme, okUrls: Set<string>, now: Date): TierAResult {
  const p: Programme = structuredClone(original)
  const today = dateOf(now)
  const closed: string[] = []
  const opened: string[] = []
  const readToday = (...es: (Evidence | undefined)[]) => es.every((e) => e && okUrls.has(e.source_url))

  // An upcoming call that is due to open but can't (its pages weren't read OK today) keeps its
  // old status date: dating it today would claim it was still upcoming today.
  const held = new Set(p.calls.filter((c) => c.status === 'upcoming' && c.opens && c.opens <= today).map((c) => c.evidence.status))
  for (const { evidence } of evidenceRefs(p)) {
    if (okUrls.has(evidence.source_url) && evidence.checked_at < today && !held.has(evidence)) evidence.checked_at = today
  }

  for (const c of p.calls) {
    // The stated deadline is the funder's own fact, so a call past it closes whether its page
    // read OK, failed or changed. A changed page's PR reopens it if the deadline moved.
    if (isLive(c) && c.deadline && deadlinePassed(c.deadline, now)) {
      c.status = 'closed'
      c.evidence.status = { ...c.evidence.deadline! }
      closed.push(c.id)
    } else if (c.status === 'upcoming' && c.opens && c.opens <= today && readToday(c.evidence.status, c.evidence.opens)) {
      // Opening is new information, so it needs the pages read unchanged today.
      c.status = 'open'
      c.evidence.status = { ...c.evidence.opens! }
      opened.push(c.id)
    }
  }

  const dates = evidenceRefs(p).map((r) => r.evidence.checked_at)
  const oldest = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : p.checked_at
  if (oldest > p.checked_at) p.checked_at = oldest

  const changed = JSON.stringify(p) !== JSON.stringify(original)
  return { programme: p, changed, closed, opened }
}
