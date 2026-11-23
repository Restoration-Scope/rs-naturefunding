/**
 * Seeds the faults the checks around "Before you apply" exist to catch into a temp copy of one programme and
 * runs the real checks on it: each line prints PASS or FAIL, and any FAIL exits 1. Writes nothing in data/.
 *   bun scripts/requirements/doctor.ts [programme id]
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lint, lintInput } from './lint'
import { REVIEW_FROM, brief, itemsHash, itemsOf, reviewGaps, type Verdict } from './review'
import { locate } from './verify'

const id = process.argv[2] ?? 'anglian-water-thriving-communities-fund'
const base = JSON.parse(readFileSync(join('data', 'programmes', `${id}.json`), 'utf8'))
if (!base.eligibility?.length || !base.effort?.due || !base.geography?.label) throw new Error(`${id} needs eligibility, dated effort and a geography label`)
const tmp = mkdtempSync(join(tmpdir(), 'nf-doctor-'))

/** Runs `bun run validate` on one copy of the programme (and its manifest), as deploy does. */
function validate(p: object, manifest?: object) {
  const dir = join(tmp, String(Math.random()).slice(2))
  mkdirSync(join(dir, 'programmes'), { recursive: true })
  mkdirSync(join(dir, 'requirements'), { recursive: true })
  writeFileSync(join(dir, 'programmes', `${id}.json`), JSON.stringify(p))
  if (manifest) writeFileSync(join(dir, 'requirements', `${id}.json`), JSON.stringify(manifest))
  const r = Bun.spawnSync(['bun', 'scripts/data/validate.ts', '--dir', join(dir, 'programmes'), '--no-sources', '--requirements', join(dir, 'requirements')])
  return { ok: r.exitCode === 0, out: r.stdout.toString() + r.stderr.toString() }
}

const results: [string, boolean, string][] = []
const expect = (name: string, caught: boolean, detail = '') => results.push([name, caught, detail])
const copy = () => structuredClone(base)

// Baseline: the real programme passes, so every catch below is the seeded fault's.
const clean = validate(base)
expect('baseline passes validate', clean.ok, clean.ok ? '' : clean.out.split('\n')[0]!)

const long = copy()
long.eligibility[0].rule = `${long.eligibility[0].rule} ${'and more words'.repeat(10)}`.slice(0, 130)
expect('rule over 120 characters', !validate(long).ok)

const undated = copy()
const at = undated.effort.due.findIndex((d: string | null) => d !== null)
undated.effort.due[at] = '2031-03-17'
expect('due date its quote does not state', !validate(undated).ok)

const place = copy()
place.eligibility.push({ rule: `Be located in ${base.geography.label}`, kind: 'project' })
place.evidence.eligibility.push(base.evidence.eligibility[0])
expect('rule that repeats the geography', lint(lintInput(place)).some((f) => f.check === 'restates_geography'))

const docs = [{ ref: 'D1', url: base.evidence.eligibility[0].source_url, final_url: base.evidence.eligibility[0].source_url, text: 'Applicants must be registered charities.' }]
expect('quote not on the page it cites', locate(docs as never, { doc: 'D1', quote: base.evidence.eligibility[0].quote }) === null)

const manifest = { id, read_on: REVIEW_FROM }
expect('reading with no second reader', !validate(base, manifest).ok)
const review = { on: REVIEW_FROM, standards: 'doctor', reviewer: 'doctor', hash: itemsHash(base), verdicts: { sound: 1, wrong: 0, missed: 0 }, canaries: { planted: 1, caught: 1 } }
expect('reviewed reading passes', validate(base, { ...manifest, review }).ok)
const edited = copy()
edited.eligibility[0].rule = `${edited.eligibility[0].rule.slice(0, 100)} (edited)`
expect('reading edited after its review', !validate(edited, { ...manifest, review }).ok)

const { key } = brief([base], { stamp: 'doctor', dir: tmp, standards: 'standards: doctor', worktree: '.' })
const sound: Verdict[] = itemsOf(base).map((it) => ({ id, field: it.field, index: it.index, text: it.text, verdict: 'sound', category: 'ok', action: 'keep', reason: 'doctor' }))
const c = key.canaries[0]!
const caught: Verdict = { id, field: 'eligibility', index: c.index, text: c.text, verdict: 'wrong', category: 'says_more_than_quote', action: 'drop', reason: 'doctor' }
expect('complete review with its canary caught applies', reviewGaps([base], key, [...sound, caught]).length === 0)
expect('canary the reviewer passed', reviewGaps([base], key, [...sound, { ...caught, verdict: 'sound', category: 'ok', action: 'keep' }]).some((g) => g.includes('canary')))
expect('item left without a verdict', reviewGaps([base], key, [...sound.slice(1), caught]).some((g) => g.includes('0 verdicts')))

let missed = 0
for (const [name, ok, detail] of results) {
  if (!ok) missed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`)
}
console.log(missed ? `${missed} of ${results.length} failed: the checks are broken; fix them before trusting a review` : `all ${results.length} pass (${id})`)
process.exit(missed ? 1 : 0)
