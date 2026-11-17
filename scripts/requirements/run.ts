/**
 * Reads programmes' requirements end to end and writes the results.
 *
 *   bun scripts/requirements/run.ts <id…>            these programmes
 *   bun scripts/requirements/run.ts --queue 30       the first 30 due, open and upcoming calls first
 *   bun scripts/requirements/run.ts --gold tune|held|all   the gold set (never writes data)
 *
 * Options: --dry (write only the run folder), --cap <usd> (spend cap, default 10), --cheap <model>
 * (claude-haiku-5-5 default, or workers), --strong <model> (claude-opus-5-5), --no-jev, --out <dir>
 * (default .cache/requirements/runs/<time>), --exclude <file> (ids to skip, one per line).
 * Needs ANTHROPIC_API_KEY (or CLOUDFLARE_* for --cheap workers) and TYPESAFE_API_KEY.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadData } from '../../src/data/load'
import type { Source } from '../../src/data/schema'
import { formatJson } from '../refresh/json'
import { PROMPT_VERSION } from './extract'
import { politeReader } from './gather'
import { Cache, claudeModel, Ledger, metered, meteredJev, SpendCapError, typesafeJev, workersModel, type JsonModel } from './models'
import { run, type Result } from './pipeline'
import { MANIFEST_DIR, manifestPath, queue } from './queue'
import { apply, manifest, serialise } from './write'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    queue: { type: 'string' },
    gold: { type: 'string' },
    dry: { type: 'boolean', default: false },
    cap: { type: 'string', default: '10' },
    cheap: { type: 'string', default: 'claude-haiku-5-5' },
    strong: { type: 'string', default: 'claude-opus-5-5' },
    'no-jev': { type: 'boolean', default: false },
    out: { type: 'string' },
    exclude: { type: 'string' },
  },
})

const today = new Date().toISOString().slice(0, 10)
const out = values.out ?? join('.cache', 'requirements', 'runs', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(join(out, 'results'), { recursive: true })

const { programmes, sources } = loadData()
const byId = new Map(programmes.map((p) => [p.id, p]))
const gold = JSON.parse(readFileSync('tests/fixtures/requirements/index.json', 'utf8')) as { programmes: { id: string; split: 'tune' | 'held' }[] }
const goldIds = new Set(gold.programmes.map((g) => g.id))

let ids: string[] = positionals
const write = !values.dry && !values.gold
if (values.gold) ids = gold.programmes.filter((g) => values.gold === 'all' || g.split === values.gold).map((g) => g.id)
if (values.queue) {
  const states = existsSync('data/checks/sources.json') ? JSON.parse(readFileSync('data/checks/sources.json', 'utf8')) : {}
  const exclude = new Set([...goldIds, ...(values.exclude ? readFileSync(values.exclude, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : [])])
  const due = queue(programmes, sources, states, today, { exclude })
  ids = due.slice(0, Number(values.queue)).map((d) => d.id)
  writeFileSync(join(out, 'queue.json'), formatJson(due.slice(0, Number(values.queue))))
}
if (!ids.length) throw new Error('no programmes to read: pass ids, --queue N or --gold tune|held|all')
for (const id of ids) if (!byId.has(id)) throw new Error(`no programme ${id}`)

const ledger = new Ledger(Number(values.cap))
const cache = new Cache(join('.cache', 'requirements', 'llm'))
const cheapModel: JsonModel | null = values.cheap === 'workers' ? workersModel() : claudeModel(values.cheap!, { maxTokens: 16000 })
if (!cheapModel) throw new Error('no extractor: set the Anthropic or Cloudflare keys')
const strongModel = claudeModel(values.strong!, { effort: 'high', maxTokens: 32000 })
const jevModel = values['no-jev'] ? null : typesafeJev()
if (!values['no-jev'] && !jevModel) throw new Error('TYPESAFE_API_KEY is not set (pass --no-jev to run without checks)')

const deps = {
  read: politeReader(join('.cache', 'requirements', 'pages')),
  sources,
  cheap: metered(cheapModel, ledger, cache, PROMPT_VERSION),
  strong: metered(strongModel, ledger, cache, PROMPT_VERSION),
  jev: jevModel ? meteredJev(jevModel, ledger, cache, PROMPT_VERSION) : null,
}

let currentSources: Source[] = sources
const summary: { id: string; usd: number; complete: boolean; stamped: boolean; outcomes: Result['outcomes']; docs: number; error?: string }[] = []
mkdirSync(MANIFEST_DIR, { recursive: true })

for (const id of ids) {
  const p = byId.get(id)!
  let r: Result
  try {
    r = await run(p, deps)
  } catch (e) {
    if (e instanceof SpendCapError) {
      console.error(`stopped: ${e.message}`)
      break
    }
    console.error(`${id}: ${(e as Error).message}`)
    summary.push({ id, usd: ledger.byProgramme[id] ?? 0, complete: false, stamped: false, outcomes: {} as Result['outcomes'], docs: 0, error: (e as Error).message })
    continue
  }
  const usd = ledger.byProgramme[id] ?? 0
  const applied = apply(p, r, today, currentSources)
  const models = [cheapModel.name, ...(r.escalated.length ? [strongModel.name] : []), ...(jevModel ? [jevModel.name] : [])]
  const m = manifest(r, today, applied.manifestBits, models, usd)
  // Full result for eval and debugging; page text stays out of the repo.
  writeFileSync(join(out, 'results', `${id}.json`), JSON.stringify({ ...r, gathered: { ...r.gathered, docs: r.gathered.docs.map(({ text: _t, pages: _p, selected: _s, links, ...d }) => ({ ...d, links: links.length })) }, manifest: m }, null, 1))
  if (write) {
    writeFileSync(join('data', 'programmes', `${id}.json`), serialise(applied.next, readFileSync(join('data', 'programmes', `${id}.json`), 'utf8')))
    writeFileSync(manifestPath(id), formatJson(m))
    currentSources = applied.sources
  }
  summary.push({ id, usd, complete: m.complete, stamped: m.requirements_checked, outcomes: m.outcomes, docs: m.documents.length })
  console.log(`${id}: ${m.documents.length} docs, ${Object.entries(m.outcomes).map(([k, v]) => `${k}=${v}`).join(' ')}${m.requirements_checked ? ', checked' : ''}, $${usd.toFixed(4)}`)
}

if (write && currentSources !== sources) writeFileSync(join('data', 'sources.json'), `${JSON.stringify(currentSources, null, 2)}\n`)

const report = {
  run_on: today,
  prompt_version: PROMPT_VERSION,
  programmes: summary.length,
  stamped: summary.filter((s) => s.stamped).length,
  usd: Math.round(ledger.total * 10000) / 10000,
  usd_per_programme: summary.length ? Math.round((ledger.total / summary.length) * 10000) / 10000 : 0,
  by_model: ledger.byModel,
  summary,
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\n${report.programmes} programmes, ${report.stamped} checked, $${report.usd} ($${report.usd_per_programme} each). Run folder: ${out}`)
