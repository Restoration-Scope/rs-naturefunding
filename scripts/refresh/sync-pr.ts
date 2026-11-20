/**
 * Brings a refresh PR up to date with main so it can merge. The daily job dates facts on main
 * while a PR waits, so the two often differ only in `checked_at` / `accepted_at` dates: those
 * conflicts resolve to the later date. Any other conflict stops, merge aborted, exit 2.
 *   bun scripts/refresh/sync-pr.ts <pr number> [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DATE_LINE = /^(\s*"(?:checked_at|accepted_at)": ")(\d{4}-\d{2}-\d{2})(",?)$/

/** The file with every conflict resolved, or null when a conflict is more than dates. Pure. */
export function resolveDateConflicts(text: string): string | null {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('<<<<<<< ')) {
      out.push(lines[i])
      continue
    }
    const ours: string[] = []
    const theirs: string[] = []
    let j = i + 1
    for (; j < lines.length && !lines[j].startsWith('======='); j++) ours.push(lines[j])
    for (j++; j < lines.length && !lines[j].startsWith('>>>>>>> '); j++) theirs.push(lines[j])
    if (j >= lines.length || ours.length !== theirs.length) return null
    for (let k = 0; k < ours.length; k++) {
      if (ours[k] === theirs[k]) {
        out.push(ours[k])
        continue
      }
      const a = DATE_LINE.exec(ours[k])
      const b = DATE_LINE.exec(theirs[k])
      if (!a || !b || a[1] !== b[1] || a[3] !== b[3]) return null
      out.push(a[2] > b[2] ? ours[k] : theirs[k])
    }
    i = j
  }
  return out.join('\n')
}

if (import.meta.main) {
  const [num] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const dryRun = process.argv.includes('--dry-run')
  if (!num) {
    console.error('usage: bun scripts/refresh/sync-pr.ts <pr number> [--dry-run]')
    process.exit(1)
  }
  const sh = (cmd: string[], cwd?: string) => {
    const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
    return { ok: r.exitCode === 0, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() }
  }
  const must = (cmd: string[], cwd?: string) => {
    const r = sh(cmd, cwd)
    if (!r.ok) throw new Error(`${cmd.join(' ')}: ${r.err}`)
    return r.out
  }
  const branch = must(['gh', 'pr', 'view', num, '--json', 'headRefName', '-q', '.headRefName'])
  if (!branch.startsWith('refresh/')) throw new Error(`#${num} is not a refresh PR (${branch})`)
  must(['git', 'fetch', '--quiet', 'origin', 'main', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
  const dir = resolve('.cache', 'sync-pr', branch.replaceAll('/', '-'))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(resolve('.cache', 'sync-pr'), { recursive: true })
  must(['git', 'worktree', 'add', '--detach', dir, `origin/${branch}`])
  let code = 0
  try {
    if (sh(['git', 'merge-base', '--is-ancestor', 'origin/main', 'HEAD'], dir).ok) {
      console.log(`#${num} already has main`)
    } else {
      const merged = sh(['git', 'merge', '--no-edit', '-m', 'Merge main into this refresh PR', 'origin/main'], dir)
      if (!merged.ok) {
        const conflicted = must(['git', 'diff', '--name-only', '--diff-filter=U'], dir).split('\n').filter(Boolean)
        const stuck = conflicted.filter((f) => {
          // A modify/delete conflict leaves no markers: that is never only dates.
          if (!existsSync(join(dir, f))) return true
          const text = readFileSync(join(dir, f), 'utf8')
          if (!text.includes('<<<<<<< ')) return true
          const fixed = resolveDateConflicts(text)
          if (fixed === null) return true
          writeFileSync(join(dir, f), fixed)
          must(['git', 'add', '--', f], dir)
          return false
        })
        if (!conflicted.length || stuck.length) {
          sh(['git', 'merge', '--abort'], dir)
          console.error(`#${num}: conflicts beyond dates in ${stuck.join(', ') || '(merge failed)'}; resolve by hand or close it`)
          code = 2
        } else must(['git', 'commit', '--no-edit'], dir)
      }
      if (code === 0) {
        const valid = sh(['bun', resolve('scripts', 'data', 'validate.ts')], dir)
        if (!valid.ok) {
          console.error(`#${num}: merged with main but data/ fails validation:\n${valid.err || valid.out}`)
          code = 2
        } else if (dryRun) console.log(`#${num}: merges with main cleanly (dry run, not pushed)`)
        else {
          must(['git', 'push', 'origin', `HEAD:refs/heads/${branch}`], dir)
          console.log(`#${num}: main merged in and pushed`)
        }
      }
    }
  } finally {
    sh(['git', 'worktree', 'remove', '--force', dir])
  }
  process.exit(code)
}
