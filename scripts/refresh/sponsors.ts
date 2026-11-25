/**
 * The weekly re-read of data/sponsors/ (weekly.ts). A page counts as read when every quote cited from it is still
 * there and it didn't move to another site (`classify`, as for programmes): its facts get today's date. Otherwise
 * none of them do, and the page is raised as a refresh issue (open-prs.ts) or, when it couldn't be read, listed in
 * the weekly summary. Values and quotes are never written.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sponsor as sponsorSchema, sponsorFacts, type Sponsor } from '../../src/data/sponsors'
import { readPages, type FailureKind, type Fetched } from './fetch'
import { formatJson } from './json'
import { classify, dateOf, type QuoteRef } from './tier'

export const SPONSORS_DIR = join(process.cwd(), 'data', 'sponsors')

export type SponsorPage = { url: string; sponsors: string[]; quotes: number } & (
  | { result: 'same' }
  | { result: 'changed'; reasons: string[] }
  | { result: 'failed'; kind: FailureKind; message: string }
)

export type SponsorPass = {
  pages: SponsorPage[]
  /** Sponsors whose dates moved, ready to write. */
  updated: Sponsor[]
  /** Facts whose date moved. */
  dated: number
  /** Facts a person read (method `human`): no page re-read dates them. */
  human: number
  /** Sponsors whose dated file fails the schema, with the problem; not written. */
  invalid: string[]
}

/** A draft with no files: open-prs.ts raises it as an issue. */
export type IssueDraft = { files: Record<string, never>; title: string; body: string }

/** The quotes cited from each page, across all sponsors. */
function quotesByPage(sponsors: Sponsor[]): Map<string, QuoteRef[]> {
  const byPage = new Map<string, QuoteRef[]>()
  for (const s of sponsors) {
    for (const { path, evidence } of sponsorFacts(s)) {
      if (evidence.method === 'human') continue
      byPage.set(evidence.source_url, [...(byPage.get(evidence.source_url) ?? []), { programme_id: s.id, path, quote: evidence.quote }])
    }
  }
  return byPage
}

export async function readSponsorPages(sponsors: Sponsor[]): Promise<Map<string, Fetched>> {
  const items = [...quotesByPage(sponsors).keys()].map((url) => ({ url, selector: null }))
  return new Map([...(await readPages(items))].map(([item, page]) => [item.url, page]))
}

export function sponsorPass(sponsors: Sponsor[], reads: Map<string, Fetched>, now: Date): SponsorPass {
  const today = dateOf(now)
  const pages = [...quotesByPage(sponsors)].map(([url, quotes]): SponsorPage => {
    const page = { url, sponsors: [...new Set(quotes.map((q) => q.programme_id))], quotes: quotes.length }
    const read = reads.get(url)
    if (!read) return { ...page, result: 'failed', kind: 'network', message: 'not read' }
    if (!read.ok) return { ...page, result: 'failed', kind: read.kind, message: read.message }
    const tier = classify(read, null, quotes)
    return tier.tier === 'A' ? { ...page, result: 'same' } : { ...page, result: 'changed', reasons: tier.reasons }
  })
  const same = new Set(pages.filter((p) => p.result === 'same').map((p) => p.url))

  const pass: SponsorPass = { pages, updated: [], dated: 0, human: 0, invalid: [] }
  for (const original of sponsors) {
    const s = structuredClone(original)
    const facts = sponsorFacts(s).map((f) => f.evidence)
    pass.human += facts.filter((e) => e.method === 'human').length
    const read = facts.filter((e) => e.method !== 'human' && same.has(e.source_url) && e.checked_at < today)
    if (!read.length) continue
    for (const e of read) e.checked_at = today
    s.checked_at = facts.map((e) => e.checked_at).sort()[0]
    const check = sponsorSchema.safeParse(s)
    if (!check.success) {
      pass.invalid.push(`\`${s.id}\`: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
      continue
    }
    pass.dated += read.length
    pass.updated.push(s)
  }
  return pass
}

export const rawSponsors = (ids: string[], dir = SPONSORS_DIR): Sponsor[] => ids.map((id) => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')))

/** Writes a sponsor in the layout its file already has. */
export function writeSponsor(s: Sponsor, dir = SPONSORS_DIR): void {
  const file = join(dir, `${s.id}.json`)
  const was = readFileSync(file, 'utf8')
  const plain = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`
  writeFileSync(file, plain(JSON.parse(was)) === was ? plain(s) : formatJson(s))
}

/** One issue per changed page. Its title is the page, so next week's run updates the issue it opened. */
export function sponsorIssues(pass: SponsorPass): IssueDraft[] {
  return pass.pages.flatMap((p) =>
    p.result !== 'changed'
      ? []
      : [
          {
            files: {},
            title: `Refresh: fiscal sponsor page ${p.url.replace(/^https?:\/\//, '')}`.slice(0, 250),
            body: [
              p.url,
              '',
              `Cited by ${p.sponsors.map((id) => `\`data/sponsors/${id}.json\``).join(', ')}.`,
              '',
              ...p.reasons.map((r) => `- ${r}`),
              '',
              `Nothing was changed: the ${p.quotes} facts citing this page keep their dates until every quote on it is confirmed, and a sponsor leaves the site 90 days after its oldest date.`,
              '',
              'Read the page, then fix or drop each fact whose quote is gone (verbatim quote and today’s date, checked with `bun run verify-sponsors <id>`) in a PR for a person to merge. Never infer a value. Close this issue with it.',
            ].join('\n'),
          },
        ],
  )
}

export function sponsorCounts(pass: SponsorPass, sponsors: number): string {
  const n = (result: SponsorPage['result']) => pass.pages.filter((p) => p.result === result).length
  const human = pass.human ? `; ${pass.human} facts only a person can re-read` : ''
  return `${pass.pages.length} pages of ${sponsors} sponsors: ${n('same')} with every quote still there, ${n('changed')} changed, ${n('failed')} not read. ${pass.dated} facts dated today in ${pass.updated.length} sponsors${human}.`
}

/** A line for each page that wasn't the same, and each sponsor that couldn't be written. */
export const sponsorProblems = (pass: SponsorPass): string[] => [
  ...pass.pages.flatMap((p) => {
    const where = `${p.url} (${p.sponsors.join(', ')})`
    if (p.result === 'changed') return [`- changed ${where}: ${p.reasons.join('; ')}`]
    return p.result === 'failed' ? [`- not read ${where}: ${p.kind}, ${p.message}`] : []
  }),
  ...pass.invalid.map((i) => `- not written, the dated file fails the schema: ${i}`),
]

/** The weekly summary's section. `staleBefore` is the date 30 days ago. */
export function sponsorSection(pass: SponsorPass, sponsors: Sponsor[], staleBefore: string): string[] {
  const updated = new Map(pass.updated.map((s) => [s.id, s]))
  const stale = sponsors.map((s) => updated.get(s.id) ?? s).filter((s) => s.checked_at < staleBefore)
  return [
    '### Fiscal sponsors',
    sponsorCounts(pass, sponsors.length),
    ...sponsorProblems(pass),
    ...stale.map((s) => `- stale over 30 days: \`${s.id}\` last fully re-read ${s.checked_at}`),
  ]
}
