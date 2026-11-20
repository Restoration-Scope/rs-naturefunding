/**
 * Tier B drafting within a time budget, and which changed pages an open review PR already covers.
 * The daily job hit its 90-minute limit once 200 changed pages were each re-read by two models
 * one after another; these keep it inside the limit.
 */

/**
 * Runs `work` on items, `parallel` at a time, until `deadline` (epoch ms). At the deadline it
 * starts nothing new and stops waiting: work still running is abandoned and its result dropped.
 * `work` must not throw. Returns results in item order and the items left for the next run.
 */
export async function withinBudget<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
  opts: { parallel: number; deadline: number },
): Promise<{ done: [T, R][]; deferred: T[] }> {
  const results = new Map<T, R>()
  let stopped = false
  let next = 0
  let stop = () => {}
  const timeUp = new Promise<void>((resolve) => (stop = resolve))
  const timer = setTimeout(() => ((stopped = true), stop()), Math.max(0, opts.deadline - Date.now()))
  const lane = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++]
      const r = await work(item)
      if (!stopped) results.set(item, r)
    }
  }
  await Promise.race([Promise.all(Array.from({ length: Math.max(1, Math.min(opts.parallel, items.length)) }, lane)), timeUp])
  stopped = true
  clearTimeout(timer)
  return {
    done: items.filter((i) => results.has(i)).map((i) => [i, results.get(i)!]),
    deferred: items.filter((i) => !results.has(i)),
  }
}

/** The source id in a refresh branch name: refresh/<source-id>-<run id>. */
export const sourceOfBranch = (branch: string) => branch.replace(/^refresh\//, '').replace(/-\d+$/, '')

function run(cmd: string[]): string {
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' })
  if (r.exitCode !== 0) throw new Error(`${cmd.slice(0, 3).join(' ')} failed: ${r.stderr.toString().trim().slice(0, 300)}`)
  return r.stdout.toString()
}

/**
 * Per source id, the page hash an open refresh PR proposes to accept (its
 * data/checks/accepted/<id>.json). A page read today with that hash needs no new draft:
 * the open PR already proposes this version. Empty when GitHub can't be reached.
 */
export function openPrPageHashes(): Map<string, string> {
  const out = new Map<string, string>()
  try {
    const prs = JSON.parse(run(['gh', 'pr', 'list', '--label', 'refresh', '--state', 'open', '--json', 'headRefName', '--limit', '1000'])) as { headRefName: string }[]
    const branches = prs.map((p) => p.headRefName).filter((b) => b.startsWith('refresh/'))
    if (!branches.length) return out
    run(['git', 'fetch', '--quiet', '--depth=1', 'origin', ...branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`)])
    for (const b of branches) {
      const id = sourceOfBranch(b)
      try {
        const hash = (JSON.parse(run(['git', 'show', `origin/${b}:data/checks/accepted/${id}.json`])) as { hash?: string }).hash
        if (hash) out.set(id, hash)
      } catch {}
    }
  } catch (e) {
    console.warn(`open refresh PRs not read, every changed page gets a draft: ${(e as Error).message}`)
  }
  return out
}
