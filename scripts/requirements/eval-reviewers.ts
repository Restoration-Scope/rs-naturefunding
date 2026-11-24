/**
 * Which model should be the second reader. Every candidate gets the same brief (a canary in every programme),
 * runs through its own route, and is scored against the planted canaries and the other reviewers.
 *
 *   bun scripts/requirements/eval-reviewers.ts brief <model,model…> <ids…>   one review dir per model, same canaries
 *   bun scripts/requirements/eval-reviewers.ts run <stamp> [model…]          runs them in parallel (cursor-agent, codex)
 *   bun scripts/requirements/eval-reviewers.ts score <stamp> [--labels <batch,batch…>]
 *
 * Models: a Cursor id (`claude-sonnet-5-5-high`, `gemini-4-neon-high`) bills Cursor credits; `gpt-6.2-sol-high`
 * style ids run through `codex exec` on the ChatGPT plan. Score columns: canaries caught, apply-blocking gaps,
 * agreement with the majority on each item, wrong items found, tokens and minutes; a run that opened earlier verdicts is
 * marked. The majority favours lenient reviewers: settle disputed items against the funders' pages with two judges of
 * different families before naming a winner (2026-11-24 result in review.ts at modelBase). `--labels` adds earlier
 * reviews of the same items from tests/fixtures/review-labels/ as voters. Then `review.ts apply` on a model's dir
 * shows whether its edits pass validate and the quote check (restore data/ and tests/ after).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runReviewer, type Run } from './reviewer-run'
import { brief, hasItems, itemsOf, keyFile, readJson, reviewGaps, verdict, type Key, type Verdict } from './review'

const STANDARDS = join('docs', 'review-standards.md')
const ROOT = join('.cache', 'review')
const dirOf = (stamp: string, model: string) => join(ROOT, `${stamp}-${model}`)
const modelsOf = (stamp: string) =>
  readdirSync(ROOT)
    .filter((d) => d.startsWith(`${stamp}-`) && existsSync(join(ROOT, d, 'brief.md')))
    .map((d) => d.slice(stamp.length + 1))

function runBrief(models: string[], ids: string[]) {
  const stamp = `eval-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  const ps = ids.map((id) => readJson(join('data', 'programmes', `${id}.json`))).filter(hasItems)
  for (const m of models) {
    const dir = dirOf(stamp, m)
    mkdirSync(dir, { recursive: true })
    // The same stamp seeds the same canaries in every model's brief; only the verdicts path differs.
    const b = brief(ps, { stamp, dir, standards: readFileSync(STANDARDS, 'utf8'), worktree: process.cwd(), everyProgramme: true })
    writeFileSync(join(dir, 'brief.md'), `${b.text}\n\nDo this yourself; spawn no agents and call no other models.\n`)
    mkdirSync(join(keyFile(dir), '..'), { recursive: true })
    writeFileSync(keyFile(dir), `${JSON.stringify(b.key, null, 2)}\n`)
    if (m === models[0]) console.log(`${stamp}: ${ps.length} programmes, ${b.key.canaries.length} canaries`)
  }
  console.log(`then: bun scripts/requirements/eval-reviewers.ts run ${stamp}`)
}

async function runAll(stamp: string, only: string[]) {
  const models = only.length ? only : modelsOf(stamp)
  const runs = await Promise.all(models.map((m) => runReviewer(dirOf(stamp, m), m).catch((e) => ({ model: m, error: String(e) }))))
  for (const r of runs) console.log(JSON.stringify(r))
}

const mins = (ms: number) => (ms / 60_000).toFixed(1)

function score(stamp: string, labelBatches: string[]) {
  const models = modelsOf(stamp)
  const key0: Key = readJson(keyFile(dirOf(stamp, models[0]!)))
  const ids = Object.keys(key0.hashes)
  const ps = ids.map((id) => readJson(join('data', 'programmes', `${id}.json`)))
  const isCanary = (v: { id: string; field: string; index: number | null }) => key0.canaries.some((c) => c.id === v.id && c.field === v.field && c.index === v.index)
  const voters = new Map<string, Verdict[]>()
  const peeked = new Set<string>()
  const meta = new Map<string, { gaps: number; caught: number; bad: number; run?: Run; firstGaps: string[] }>()
  for (const m of models) {
    const dir = dirOf(stamp, m)
    const f = join(dir, 'verdicts.jsonl')
    const vs: Verdict[] = []
    let bad = 0
    for (const l of existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((x) => x.trim()) : []) {
      try {
        vs.push(verdict.parse(JSON.parse(l)))
      } catch {
        bad++
      }
    }
    const gaps = reviewGaps(ps, key0, vs)
    // A reviewer that opened earlier verdicts on these items copied rather than read; its row doesn't count.
    const log = ['stdout.txt', 'stderr.txt'].map((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '')).join('')
    if (/review-labels\/[\w-]+\.jsonl|git (log|show|diff)\b/.test(log)) peeked.add(m)
    const caught = key0.canaries.filter((c) => !gaps.some((g) => g.startsWith(`${c.id}: canary`))).length
    voters.set(m, vs)
    meta.set(m, { gaps: gaps.filter((g) => !g.includes(': canary ')).length, caught: vs.length ? caught : 0, bad, run: existsSync(join(dir, 'run.json')) ? readJson(join(dir, 'run.json')) : undefined, firstGaps: gaps.slice(0, 3) })
  }
  if (labelBatches.length) {
    const lines = readdirSync(join('tests', 'fixtures', 'review-labels'))
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) => readFileSync(join('tests', 'fixtures', 'review-labels', f), 'utf8').split('\n').filter((x) => x.trim()))
      .map((l) => JSON.parse(l))
      .filter((v) => labelBatches.includes(v.batch) && ids.includes(v.id))
    voters.set('labels', lines)
  }
  // The majority on each real item: wrong when more voters with a verdict on it say wrong than sound.
  const items = ps.flatMap((p) => itemsOf(p).map((it) => ({ id: p.id as string, ...it })))
  const call = (vs: Verdict[], it: (typeof items)[number]) => vs.find((v) => v.id === it.id && v.field === it.field && v.index === it.index && v.verdict !== 'missed')?.verdict
  const majority = new Map(
    items.map((it) => {
      const calls = [...voters.values()].map((vs) => call(vs, it)).filter(Boolean)
      const w = calls.filter((c) => c === 'wrong').length
      return [`${it.id}|${it.field}|${it.index}`, { wrong: w > calls.length - w, split: w > 0 && w < calls.length, n: calls.length }]
    }),
  )
  const majWrong = [...majority.values()].filter((x) => x.wrong).length
  console.log(`${stamp}: ${ids.length} programmes, ${items.length} items, ${key0.canaries.length} canaries; majority says ${majWrong} items wrong; voters: ${[...voters.keys()].join(', ')}\n`)
  console.log('model | canaries | gaps | bad lines | agree | wrong found (of majority) | wrong it alone flags | missed facts | tokens in/out/cache-read | min | reported')
  for (const [m, vs] of voters) {
    let agree = 0, seen = 0, found = 0, alone = 0
    for (const it of items) {
      const c = call(vs, it)
      if (!c) continue
      const maj = majority.get(`${it.id}|${it.field}|${it.index}`)!
      seen++
      if ((c === 'wrong') === maj.wrong) agree++
      if (c === 'wrong' && maj.wrong) found++
      if (c === 'wrong' && !maj.wrong) alone++
    }
    const x = meta.get(m)
    const t = x?.run?.tokens
    console.log(
      [m, x ? `${x.caught}/${key0.canaries.length}` : '-', x?.gaps ?? '-', x?.bad ?? '-', seen ? `${Math.round((100 * agree) / seen)}% of ${seen}` : '-', `${found}/${majWrong}`, alone, vs.filter((v) => v.verdict === 'missed' && !isCanary(v)).length, t ? `${t.input}/${t.output}/${t.cacheRead}` : '-', x?.run ? mins(x.run.ms) : '-', `${x?.run?.reported ?? '-'}${peeked.has(m) ? ' PEEKED at earlier verdicts' : ''}`].join(' | '),
    )
  }
  for (const [m, x] of meta) if (x.firstGaps.length) console.log(`\n${m} first gaps:\n  ${x.firstGaps.join('\n  ')}`)
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2)
  const flag = (name: string) => {
    const i = rest.indexOf(name)
    return i === -1 ? undefined : rest.splice(i, 2)[1]
  }
  if (cmd === 'brief' && rest.length > 1) runBrief(rest[0]!.split(','), rest.slice(1))
  else if (cmd === 'run' && rest.length) await runAll(rest[0]!, rest.slice(1))
  else if (cmd === 'score' && rest.length) {
    const labels = flag('--labels')
    score(rest[0]!, labels ? labels.split(',') : [])
  } else {
    console.error('usage: eval-reviewers.ts brief <model,model…> <ids…> | run <stamp> [model…] | score <stamp> [--labels <batch,…>]')
    process.exit(2)
  }
}
