/**
 * The daily refresh. Reads every due page in data/sources.json, writes Tier A results and
 * per-source state into data/ (the workflow commits them to main), and leaves one Tier B
 * pull request draft per changed page in the drafts folder (open-prs.ts opens them).
 *   bun scripts/refresh/run.ts [--all] [--only id,id] [--simulate changed:id,blocked:id] [--drafts dir]
 * --simulate exists to prove the Tier B and blocked paths on demand; the schedule never sets it.
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkData } from '../../src/data/load'
import type { Programme, Source } from '../../src/data/schema'
import { programme as programmeSchema } from '../../src/data/schema'
import { readPages, type Fetched } from './fetch'
import { formatJson } from './json'
import { llmFromEnv } from './llm'
import {
  acceptedPath, isDue, nextState, readJson, RUN_PATH, SOURCES_PATH, writeJson,
  type Accepted, type RunReport, type SourceStates,
} from './state'
import { extractAndReview, proposalKey, type Change, type Draft } from './tier-b'
import { applyTierA, classify, dateOf, quotesAt, type Tier } from './tier'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1] ?? null
}
const only = new Set((flag('--only') ?? '').split(',').filter(Boolean))
const simulated = new Map(
  (flag('--simulate') ?? '').split(',').filter(Boolean).map((s) => s.split(':') as [string, string]).map(([kind, id]) => [id, kind]),
)
const draftsDir = resolve(flag('--drafts') ?? join('.cache', 'refresh-drafts'))
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null

const now = new Date()
const today = dateOf(now)
const programmesDir = join(process.cwd(), 'data', 'programmes')
const programmeFile = (id: string) => join(programmesDir, `${id}.json`)

const { programmes: parsed, sources, issues } = checkData()
if (issues.length) {
  console.error(`data/ has problems; fix them before refreshing:\n${issues.join('\n')}`)
  process.exit(1)
}
// Work on the files as written, not the parsed copies, so a rewrite changes only what moved.
const programmes = new Map<string, Programme>(parsed.map((p) => [p.id, JSON.parse(readFileSync(programmeFile(p.id), 'utf8'))]))

const states: SourceStates = readJson<SourceStates>(SOURCES_PATH) ?? {}
const due = sources.filter((s) =>
  only.size ? only.has(s.id) : args.includes('--all') || simulated.has(s.id) || isDue(s, states[s.id] ?? null, now),
)
console.log(`${due.length} of ${sources.length} sources due`)

const toFetch = due.filter((s) => simulated.get(s.id) !== 'blocked')
const reads = await readPages(toFetch)
for (const s of due) {
  if (simulated.get(s.id) === 'blocked') reads.set(s, { ok: false, url: s.url, kind: 'blocked', message: 'simulated block (--simulate)' })
}

const tiers = new Map<Source, Tier>()
for (const s of due) {
  const read = reads.get(s)!
  states[s.id] = nextState(states[s.id] ?? null, s, read, now)
  if (!read.ok) {
    console.log(`✗ ${s.id}: ${read.kind}, ${read.message}`)
    continue
  }
  const accepted = simulated.get(s.id) === 'changed' ? 'sha256:simulated-change' : readJson<Accepted>(acceptedPath(s.id))?.hash ?? null
  const tier = classify(read, accepted, quotesAt([...programmes.values()], s.url))
  tiers.set(s, tier)
  if (tier.tier === 'A' && tier.baseline) writeJson(acceptedPath(s.id), { hash: read.hash, accepted_at: today } satisfies Accepted)
  console.log(`${tier.tier === 'A' ? '✓' : '△'} ${s.id}: Tier ${tier.tier}${tier.tier === 'B' ? `, ${tier.reasons.join('; ')}` : ''}`)
}

// A page counts as read today only if every source watching it came back unchanged.
const okUrls = new Set<string>()
for (const [s, t] of tiers) if (t.tier === 'A') okUrls.add(s.url)
for (const [s, t] of tiers) if (t.tier === 'B') okUrls.delete(s.url)
for (const s of due) if (!reads.get(s)!.ok) okUrls.delete(s.url)

let callsClosed = 0
const invalid: string[] = []
for (const [id, p] of programmes) {
  const result = applyTierA(p, okUrls, now)
  if (!result.changed) continue
  const check = programmeSchema.safeParse(result.programme)
  if (!check.success) {
    invalid.push(`${id}: ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    continue
  }
  callsClosed += result.closed.length
  for (const c of result.closed) console.log(`closed ${id} ${c}: deadline passed`)
  for (const c of result.opened) console.log(`opened ${id} ${c}: opening date reached`)
  programmes.set(id, result.programme)
  writeFileSync(programmeFile(id), formatJson(result.programme))
}
for (const line of invalid) console.error(`not written, the Tier A result fails the schema: ${line}`)

const llm = llmFromEnv()
rmSync(draftsDir, { recursive: true, force: true })
mkdirSync(draftsDir, { recursive: true })
for (const [s, t] of tiers) {
  if (t.tier !== 'B') continue
  const read = reads.get(s) as Extract<Fetched, { ok: true }>
  const draft = await draftFor(s, programmes.get(s.programme_id)!, read, t.reasons)
  writeFileSync(join(draftsDir, `${s.id}.json`), JSON.stringify(draft, null, 2))
}

// Keep only watched sources, sorted, so a removed source leaves no state behind.
const kept = sources.map((s) => s.id).filter((id) => states[id]).sort()
writeJson(SOURCES_PATH, Object.fromEntries(kept.map((id) => [id, states[id]])))
const staleBefore = dateOf(new Date(now.getTime() - 30 * 86_400_000))
const report: RunReport = {
  run_at: new Date().toISOString(),
  run_url: runUrl,
  sources: {
    total: sources.length,
    checked: due.length,
    unchanged: [...tiers.values()].filter((t) => t.tier === 'A').length,
    changed: [...tiers.values()].filter((t) => t.tier === 'B').length,
    failed: due.filter((s) => !reads.get(s)!.ok).length,
    failing_3_plus: sources.filter((s) => (states[s.id]?.failures_in_row ?? 0) >= 3).length,
  },
  calls_closed: callsClosed,
  programmes: { total: programmes.size, stale_over_30_days: [...programmes.values()].filter((p) => p.checked_at < staleBefore).length },
}
writeJson(RUN_PATH, report)

const summary = [
  `### Refresh ${today}`,
  `Sources: ${report.sources.checked} checked, ${report.sources.unchanged} unchanged (Tier A), ${report.sources.changed} changed (Tier B), ${report.sources.failed} failed.`,
  `Calls closed: ${callsClosed}. Programmes stale over 30 days: ${report.programmes.stale_over_30_days}.`,
  ...due.filter((s) => !reads.get(s)!.ok).map((s) => {
    const r = reads.get(s) as Extract<Fetched, { ok: false }>
    return `- ✗ \`${s.id}\` ${r.kind}: ${r.message}`
  }),
  ...invalid.map((l) => `- not written: ${l}`),
].join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
if (invalid.length) process.exit(1)

async function draftFor(s: Source, p: Programme, read: Extract<Fetched, { ok: true }>, reasons: string[]): Promise<Draft> {
  const base = { source: s, programme_id: p.id, hash: read.hash, key: null, reasons }
  const title = `Refresh: ${p.name} — ${new URL(s.url).host}${new URL(s.url).pathname.replace(/\/$/, '')}`
  const head = [
    `The daily refresh found a change on ${s.url} for **${p.name}** (\`data/programmes/${p.id}.json\`).`,
    '',
    ...reasons.map((r) => `- ${r}`),
  ]
  if (!llm) return { ...base, files: {}, title, body: [...head, '', 'No LLM is configured, so nothing was re-read. Read the page and update the file by hand.'].join('\n'), datesOnly: false, review: null, error: 'no LLM configured' }
  try {
    const r = await extractAndReview(llm, p, s, read.text, now)
    const applied = r.changes.filter((c) => c.kind !== 'rejected')
    const verdict = (c: Change) => r.review?.verdicts?.find((v) => v.path === c.path)
    const cell = (v: unknown) => `\`${JSON.stringify(v ?? null).replace(/\|/g, '\\|').slice(0, 300)}\``
    const body = [
      ...head,
      '',
      '### Changes',
      r.changes.length
        ? ['| Fact | Was | Now | Quote | Reviewer |', '| --- | --- | --- | --- | --- |',
          ...r.changes.map((c) => `| ${c.path}${c.kind === 'rejected' ? ` (rejected: ${c.why})` : ` (${c.kind})`} | ${cell(c.old)} | ${cell(c.new)} | “${c.quote.replace(/\|/g, '\\|')}” | ${verdict(c) ? `${verdict(c)!.verdict}: ${verdict(c)!.reason}` : '—'} |`)].join('\n')
        : 'No fact changed. Facts still quoted on the page are dated today.',
      ...(r.unconfirmed.length ? ['', '### Not confirmed (quote gone, left as it was)', ...r.unconfirmed.map((u) => `- ${u}`)] : []),
      '',
      `### Reviewer (${llm.reviewer}): **${r.review?.overall ?? 'no answer'}**`,
      ...(r.review?.missed ? [`Missed: ${r.review.missed}`] : []),
      ...(r.notes ? ['', `Extractor (${llm.extractor}) notes: ${r.notes}`] : []),
      ...(r.truncated ? ['', `The page text was cut to ${llm.maxChars} characters for the models.`] : []),
      '',
      `### Schema: ${r.schemaErrors.length ? `**${r.schemaErrors.length} error(s)**` : 'valid'}`,
      ...r.schemaErrors.map((e) => `- ${e}`),
      '',
      '---',
      `Auto-merge is off (decisions/2026-11-01-refresh-auto-merge-off.md): check each quote on the page before merging. Merging also accepts this version of the page, so the next run compares against it.${runUrl ? ` Run: ${runUrl}` : ''}`,
    ].join('\n')
    // Only the schema's parsed value is ever written; a draft that fails the schema becomes an issue.
    if (!r.programme) return { ...base, files: {}, title, body, datesOnly: false, review: r.review, error: 'the draft does not fit the schema' }
    const key = proposalKey(s, read.hash, r.programme)
    return {
      ...base,
      key,
      files: {
        [`data/programmes/${p.id}.json`]: formatJson(r.programme),
        [`data/checks/accepted/${s.id}.json`]: formatJson({ hash: read.hash, accepted_at: today } satisfies Accepted),
      },
      title: applied.length ? title : `${title} (dates only)`,
      body: `${body}\n\n<!-- refresh-key: ${key} -->`,
      datesOnly: applied.length === 0,
      review: r.review,
      error: null,
    }
  } catch (e) {
    const message = (e as Error).message
    console.error(`Tier B for ${s.id} failed: ${message}`)
    return { ...base, files: {}, title, body: [...head, '', `Re-reading failed: ${message}`, '', 'Read the page and update the file by hand.'].join('\n'), datesOnly: false, review: null, error: message }
  }
}
