/**
 * The weekly pass: checks every link the listings show (link rot) into data/checks/links.json, re-reads the pages
 * the fiscal sponsors cite (sponsors.ts), then posts a summary issue: what was checked and changed this week, pages
 * failing 3+ times in a row, programmes not fully re-read in 30 days, broken links, open refresh PRs and the requirements
 * reading's leads (unread rules documents, application pages on other sites, unresolved fields).
 *   bun scripts/refresh/weekly.ts [--no-issue] [--drafts dir]
 */
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkData } from '../../src/data/load'
import { fetchCompletingChain } from '../data/tls-chain'
import { leadsOf, leadsSection, readManifests } from '../requirements/leads'
import type { Programme } from '../../src/data/schema'
import { classifyResponse, readPages, USER_AGENT, type Fetched } from './fetch'
import { rawSponsors, readSponsorPages, sponsorIssues, sponsorPass, sponsorSection, writeSponsor } from './sponsors'
import { LINKS_PATH, readJson, SOURCES_PATH, writeJson, type LinkState, type SourceStates } from './state'
import { dateOf } from './tier'
import { issueBody } from './weekly-body'

const now = new Date()
const today = dateOf(now)
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)

const { programmes, sources, sponsors, issues } = checkData()
if (issues.length) console.error(`data/ has problems:\n${issues.join('\n')}`)

function linksOf(p: Programme): string[] {
  return [p.url, p.funder.url, p.administered_by?.url, ...p.calls.map((c) => c.url)].filter((u): u is string => !!u)
}

/** A link is alive when it answers without an error; bot blocks count as alive but are noted. */
async function checkLink(url: string): Promise<Fetched> {
  try {
    const res = await fetchCompletingChain(url, { redirect: 'follow', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
    const body = (res.headers.get('content-type') ?? '').includes('html') ? await res.text() : ''
    const failure = classifyResponse(res.status, body)
    return failure ? { ok: false, url, ...failure } : { ok: true, url, finalUrl: res.url || url, status: res.status, pdf: false, text: '', hash: '' }
  } catch (e) {
    return { ok: false, url, kind: 'network', message: (e as Error).message }
  }
}

const urls = [...new Set(programmes.flatMap(linksOf))]
const results = await readPages(urls.map((url) => ({ url, selector: null })), (url) => checkLink(url))
const before = readJson<LinkState>(LINKS_PATH) ?? {}
const links: LinkState = {}
for (const [{ url }, r] of [...results].sort(([a], [b]) => a.url.localeCompare(b.url))) {
  const dead = !r.ok && r.kind !== 'blocked'
  links[url] = {
    ok: !dead,
    status: r.ok ? `HTTP ${r.status}` : `${r.kind}: ${r.message}`,
    checked_at: today,
    failures_in_row: dead ? (before[url]?.failures_in_row ?? 0) + 1 : 0,
  }
}
writeJson(LINKS_PATH, links)

/** Re-reads the sponsors' pages, dates what is still there and drafts an issue per changed page. A failure here costs only its section. */
async function refreshSponsors(): Promise<string[]> {
  try {
    const raw = rawSponsors(sponsors.map((s) => s.id))
    const pass = sponsorPass(raw, await readSponsorPages(raw), now)
    for (const s of pass.updated) writeSponsor(s)
    const at = process.argv.indexOf('--drafts')
    const drafts = resolve(at === -1 ? join('.cache', 'refresh-drafts') : process.argv[at + 1])
    rmSync(drafts, { recursive: true, force: true })
    mkdirSync(drafts, { recursive: true })
    sponsorIssues(pass).forEach((d, i) => writeFileSync(join(drafts, `sponsor-${i}.json`), JSON.stringify(d, null, 2)))
    return sponsorSection(pass, raw, dateOf(daysAgo(30)))
  } catch (e) {
    console.error(e)
    return ['### Fiscal sponsors', `The re-read failed: ${(e as Error).message}`]
  }
}
const sponsorLines = await refreshSponsors()

const known = readJson<SourceStates>(SOURCES_PATH) ?? {}
const states = sources.map((s) => ({ s, st: known[s.id] ?? null }))
const weekAgo = daysAgo(7).toISOString()
const checked = states.filter(({ st }) => st?.last_ok && st.last_ok >= weekAgo)
const changed = states.filter(({ st }) => st?.last_change && st.last_change >= dateOf(daysAgo(7)))
const failing = states.filter(({ st }) => (st?.failures_in_row ?? 0) >= 3)
const blockedNow = states.filter(({ st }) => st?.last_error && ['blocked', 'robots'].includes(st.last_error.kind))
const blockRate = sources.length ? Math.round((blockedNow.length / sources.length) * 100) : 0
const stale = programmes.filter((p) => p.checked_at < dateOf(daysAgo(30)))
const broken = Object.entries(links).filter(([, l]) => !l.ok)
const prs = Bun.spawnSync(['gh', 'pr', 'list', '--label', 'refresh', '--state', 'open', '--json', 'url,title']).stdout.toString()
const openPrs: { url: string; title: string }[] = prs ? JSON.parse(prs) : []

const body = [
  `Week to ${today}: ${checked.length} of ${sources.length} watched pages read, ${changed.length} changed, ${failing.length} failing 3+ times in a row, ${stale.length} programmes not fully re-read in 30 days, ${broken.length} broken links, ${openPrs.length} refresh PRs waiting.`,
  `Blocked on the last read (bot blocks and robots.txt, from GitHub's runners): ${blockedNow.length} of ${sources.length} (${blockRate}%).`,
  '',
  ...sponsorLines,
  '',
  '### Failing 3+ times in a row',
  ...(failing.length ? failing.map(({ s, st }) => `- \`${s.id}\` ${s.url}: ${st!.failures_in_row}× ${st!.last_error?.kind}, ${st!.last_error?.message} (last good read ${st!.last_ok?.slice(0, 10) ?? 'never'})`) : ['None.']),
  '',
  '### Changed this week',
  ...(changed.length ? changed.map(({ s, st }) => `- \`${s.id}\` on ${st!.last_change}`) : ['None.']),
  '',
  '### Stale over 30 days',
  ...(stale.length ? stale.map((p) => `- \`${p.id}\` last fully re-read ${p.checked_at}`) : ['None.']),
  '',
  '### Broken links',
  ...(broken.length ? broken.map(([url, l]) => `- ${url}: ${l.status}${l.failures_in_row > 1 ? ` (${l.failures_in_row} weeks)` : ''}`) : ['None.']),
  '',
  '### Refresh PRs waiting for review',
  ...(openPrs.length ? openPrs.map((p) => `- ${p.title}: ${p.url}`) : ['None.']),
  '',
  ...leadsSection(leadsOf(readManifests(), programmes)),
].join('\n')

console.log(body)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)
if (!process.argv.includes('--no-issue')) {
  mkdirSync('.cache', { recursive: true })
  const file = join('.cache', 'weekly-body.md')
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  writeFileSync(file, issueBody(body, runUrl))
  Bun.spawnSync(['gh', 'label', 'create', 'refresh-summary', '--color', '1d76db', '--force'])
  const made = Bun.spawnSync(['gh', 'issue', 'create', '--title', `Weekly refresh summary, week to ${today}`, '--label', 'refresh-summary', '--body-file', file])
  if (made.exitCode !== 0) throw new Error(`gh issue create failed: ${made.stderr.toString()}`)
  console.log(made.stdout.toString().trim())
}
