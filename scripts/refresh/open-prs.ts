/**
 * Opens one pull request per Tier B draft, on a new branch from the refreshed branch (main), and starts CI on it
 * (a PR opened with the workflow token does not trigger workflows by itself). An open PR for
 * the same page with the same content is kept; a different one is closed as superseded.
 * A draft with nothing to change becomes an issue instead. Runs in Actions after the
 * Tier A commit is pushed.
 *   bun scripts/refresh/open-prs.ts [--drafts dir]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Draft } from './tier-b'

const args = process.argv.slice(2)
const at = args.indexOf('--drafts')
const draftsDir = resolve(at === -1 ? join('.cache', 'refresh-drafts') : args[at + 1])
const bodyFile = join(draftsDir, '..', 'refresh-body.md')
const runId = process.env.GITHUB_RUN_ID ?? String(Date.now())
const base = process.env.GITHUB_REF_NAME ?? 'main'

function run(cmd: string[], opts: { allowFail?: boolean } = {}): string {
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' })
  if (r.exitCode !== 0 && !opts.allowFail) throw new Error(`${cmd.join(' ')} failed: ${r.stderr.toString().trim()}`)
  return r.exitCode === 0 ? r.stdout.toString().trim() : ''
}
const json = <T>(cmd: string[]): T => JSON.parse(run(cmd) || '[]')

const LABELS = { refresh: '0e8a16', 'reviewer:approve': 'c2e0c6', 'reviewer:reject': 'e99695', 'reviewer:unclear': 'fbca04' }
for (const [name, color] of Object.entries(LABELS)) run(['gh', 'label', 'create', name, '--color', color, '--force'], { allowFail: true })

const drafts: Draft[] = existsSync(draftsDir)
  ? readdirSync(draftsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(draftsDir, f), 'utf8')))
  : []
const openPrs = json<{ number: number; url: string; headRefName: string }[]>(
  ['gh', 'pr', 'list', '--label', 'refresh', '--state', 'open', '--json', 'number,url,headRefName', '--limit', '200'],
)
const log: string[] = []

for (const d of drafts) {
  writeFileSync(bodyFile, d.body)

  if (Object.keys(d.files).length === 0) {
    const existing = json<{ number: number; title: string }[]>(['gh', 'issue', 'list', '--state', 'open', '--label', 'refresh', '--json', 'number,title', '--limit', '100'])
      .find((i) => i.title === d.title)
    if (existing) run(['gh', 'issue', 'edit', String(existing.number), '--body-file', bodyFile])
    log.push(existing ? `updated issue #${existing.number}` : `opened issue ${run(['gh', 'issue', 'create', '--title', d.title, '--body-file', bodyFile, '--label', 'refresh'])}`)
    continue
  }

  const prefix = `refresh/${d.source.id}-`
  const branch = `${prefix}${runId}`
  run(['git', 'fetch', 'origin', base])
  run(['git', 'switch', '--create', branch, `origin/${base}`])
  for (const [path, content] of Object.entries(d.files)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  run(['git', 'add', '--', ...Object.keys(d.files)])
  run(['git', 'commit', '--allow-empty', '-m', `${d.title}\n\n${d.reasons.join('\n')}`])
  const tree = run(['git', 'rev-parse', 'HEAD^{tree}'])

  const previous = openPrs.filter((p) => p.headRefName.startsWith(prefix))
  const same = previous.find((p) => {
    run(['git', 'fetch', 'origin', p.headRefName], { allowFail: true })
    return run(['git', 'rev-parse', `origin/${p.headRefName}^{tree}`], { allowFail: true }) === tree
  })
  run(['git', 'switch', '--detach', `origin/${base}`])
  if (same) {
    log.push(`unchanged ${same.url}`)
    continue
  }

  run(['git', 'push', 'origin', `${branch}:refs/heads/${branch}`])
  const url = run(['gh', 'pr', 'create', '--base', base, '--head', branch, '--title', d.title, '--body-file', bodyFile, '--label', 'refresh', '--label', `reviewer:${d.review?.overall ?? 'unclear'}`])
  log.push(`opened ${url}`)
  for (const p of previous) {
    run(['gh', 'pr', 'close', String(p.number), '--comment', `Superseded by ${url}.`, '--delete-branch'], { allowFail: true })
    log.push(`closed ${p.url} (superseded)`)
  }
  run(['gh', 'workflow', 'run', 'ci.yml', '--ref', branch], { allowFail: true })
}

console.log(log.length ? log.join('\n') : 'no Tier B drafts')
