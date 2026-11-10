/**
 * Opens one pull request per Tier B draft, on a new branch from the refreshed branch (main). An open PR with
 * the same proposal (same page version and facts, check dates aside; see proposalKey) is kept;
 * a different one for the same page is closed as superseded.
 * A draft with nothing to change becomes an issue instead. Runs in Actions after the
 * Tier A commit is pushed.
 *   bun scripts/refresh/open-prs.ts [--drafts dir]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Draft } from './tier-b'

const args = process.argv.slice(2)
const at = args.indexOf('--drafts')
const draftsDir = resolve(at === -1 ? join('.cache', 'refresh-drafts') : args[at + 1])
const bodyFile = join(draftsDir, '..', 'refresh-body.md')
const runId = process.env.GITHUB_RUN_ID ?? String(Date.now())
const base = process.env.GITHUB_REF_NAME ?? 'main'

function run(cmd: string[], opts: { allowFail?: boolean; cwd?: string } = {}): string {
  const r = Bun.spawnSync(cmd, { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' })
  if (r.exitCode !== 0 && !opts.allowFail) throw new Error(`${cmd.join(' ')} failed: ${r.stderr.toString().trim()}`)
  return r.exitCode === 0 ? r.stdout.toString().trim() : ''
}
const json = <T>(cmd: string[]): T => JSON.parse(run(cmd) || '[]')
const branchPath = (branch: string) => join(draftsDir, '..', 'refresh-worktrees', branch.replaceAll('/', '-'))

function clearInterruptedGitOperation(): void {
  run(['git', 'rebase', '--abort'], { allowFail: true })
  run(['git', 'merge', '--abort'], { allowFail: true })
  run(['git', 'cherry-pick', '--abort'], { allowFail: true })
}

const LABELS = { refresh: '0e8a16', 'reviewer:approve': 'c2e0c6', 'reviewer:reject': 'e99695', 'reviewer:unclear': 'fbca04' }
for (const [name, color] of Object.entries(LABELS)) run(['gh', 'label', 'create', name, '--color', color, '--force'], { allowFail: true })

const drafts: Draft[] = existsSync(draftsDir)
  ? readdirSync(draftsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(draftsDir, f), 'utf8')))
  : []
const openPrs = json<{ number: number; url: string; headRefName: string; body: string }[]>(
  ['gh', 'pr', 'list', '--label', 'refresh', '--state', 'open', '--json', 'number,url,headRefName,body', '--limit', '200'],
)
const log: string[] = []
clearInterruptedGitOperation()
run(['git', 'worktree', 'prune'], { allowFail: true })

/** Opens or updates the open refresh issue with this title, using the body in bodyFile. */
function issue(title: string): void {
  const existing = json<{ number: number; title: string }[]>(['gh', 'issue', 'list', '--state', 'open', '--label', 'refresh', '--json', 'number,title', '--limit', '100'])
    .find((i) => i.title === title)
  if (existing) run(['gh', 'issue', 'edit', String(existing.number), '--body-file', bodyFile])
  log.push(existing ? `updated issue #${existing.number}` : `opened issue ${run(['gh', 'issue', 'create', '--title', title, '--body-file', bodyFile, '--label', 'refresh'])}`)
}

for (const d of drafts) {
  writeFileSync(bodyFile, d.body)

  if (Object.keys(d.files).length === 0) {
    issue(d.title)
    continue
  }

  const prefix = `refresh/${d.source.id}-`
  const branch = `${prefix}${runId}`
  const previous = openPrs.filter((p) => p.headRefName.startsWith(prefix))
  const same = d.key && previous.find((p) => p.body.includes(`<!-- refresh-key: ${d.key} -->`))
  if (same) {
    log.push(`unchanged ${same.url}`)
    continue
  }

  run(['git', 'fetch', 'origin', base])
  const worktree = branchPath(branch)
  rmSync(worktree, { recursive: true, force: true })
  mkdirSync(dirname(worktree), { recursive: true })
  run(['git', 'branch', '-D', branch], { allowFail: true })
  run(['git', 'worktree', 'add', '-b', branch, worktree, `origin/${base}`])
  try {
    for (const [path, content] of Object.entries(d.files)) {
      const target = join(worktree, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
    run(['git', 'add', '--', ...Object.keys(d.files)], { cwd: worktree })
    run(['git', 'commit', '--allow-empty', '-m', `${d.title}\n\n${d.reasons.join('\n')}`], { cwd: worktree })
    run(['git', 'push', 'origin', `${branch}:refs/heads/${branch}`], { cwd: worktree })
  } finally {
    run(['git', 'worktree', 'remove', '--force', worktree], { allowFail: true })
  }
  const url = run(['gh', 'pr', 'create', '--base', base, '--head', branch, '--title', d.title, '--body-file', bodyFile, '--label', 'refresh', '--label', `reviewer:${d.review?.overall ?? 'unclear'}`], { allowFail: true })
  if (!url) {
    // The repo setting "Allow GitHub Actions to create and approve pull requests" is off: keep the branch and say so in an issue.
    const compare = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/compare/${base}...${branch}?expand=1`
    writeFileSync(bodyFile, `${d.body}\n\n---\nActions may not open pull requests in this repo, so the proposed change is on branch \`${branch}\`. Open it as a PR: ${compare}\n`)
    issue(d.title)
    continue
  }
  log.push(`opened ${url}`)
  for (const p of previous) {
    run(['gh', 'pr', 'close', String(p.number), '--comment', `Superseded by ${url}.`, '--delete-branch'], { allowFail: true })
    log.push(`closed ${p.url} (superseded)`)
  }
}

console.log(log.length ? log.join('\n') : 'no Tier B drafts')
