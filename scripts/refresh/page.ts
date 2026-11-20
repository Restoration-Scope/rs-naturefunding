/**
 * Reads a refresh PR's funder page exactly as the daily job does (same fetcher, same selector) and
 * says, for every fact the PR's version cites from that page, whether its quote is on it now. The
 * weekly review uses it instead of a web tool, so it judges the same text the job saw.
 *   bun scripts/refresh/page.ts <pr number | source id> [--ref <git ref>]
 * Writes the page text to .cache/pages/<source id>.txt. With a PR, the facts are the PR branch's.
 * Exit 3: the page couldn't be read now (blocked, timed out); exit 4: it's gone (HTTP 404 or 410).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Programme, Source } from '../../src/data/schema'
import { comparable, quoteOnPage } from '../../src/data/text'
import { readPage } from './fetch'
import { sourceOfBranch } from './pool'
import { evidenceRefs } from './tier'

if (import.meta.main) {
  const args = process.argv.slice(2)
  const refAt = args.indexOf('--ref')
  let ref = refAt === -1 ? null : args[refAt + 1]
  const target = args.find((a, i) => !a.startsWith('--') && (refAt === -1 || i !== refAt + 1))
  if (!target) {
    console.error('usage: bun scripts/refresh/page.ts <pr number | source id> [--ref <git ref>]')
    process.exit(1)
  }
  const sh = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' })
    if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')}: ${r.stderr.toString().trim()}`)
    return r.stdout.toString().trim()
  }
  let sid = target
  if (/^\d+$/.test(target)) {
    const branch = sh(['gh', 'pr', 'view', target, '--json', 'headRefName', '-q', '.headRefName'])
    if (!branch.startsWith('refresh/')) throw new Error(`#${target} is not a refresh PR (${branch})`)
    sid = sourceOfBranch(branch)
    sh(['git', 'fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
    ref ??= `origin/${branch}`
  }
  const sources = JSON.parse(readFileSync('data/sources.json', 'utf8')) as Source[]
  const source = sources.find((s) => s.id === sid)
  if (!source) throw new Error(`no source ${sid} in data/sources.json`)
  const file = `data/programmes/${source.programme_id}.json`
  const programme = JSON.parse(ref ? sh(['git', 'show', `${ref}:${file}`]) : readFileSync(file, 'utf8')) as Programme

  const page = await readPage(source.url, source.selector)
  console.log(`${sid} · ${source.url}${ref ? ` · facts from ${ref}` : ''}`)
  if (!page.ok) {
    // 404 and 410 say the page is gone (exit 4); anything else may pass (exit 3)
    const gone = page.kind === 'http' && /HTTP (404|410)/.test(page.message)
    console.log(`page ${gone ? 'gone' : 'not read'}: ${page.kind}: ${page.message}`)
    process.exit(gone ? 4 : 3)
  }
  const out = resolve('.cache', 'pages', `${sid}.txt`)
  mkdirSync(join(out, '..'), { recursive: true })
  writeFileSync(out, page.text)
  // Only the host and path: a CDN redirect can carry a signed query string.
  const final = new URL(page.finalUrl)
  if (page.finalUrl !== source.url) console.log(`redirected to ${final.origin}${final.pathname}`)
  console.log(`page text (${page.text.length} characters): ${out}`)
  const text = comparable(page.text)
  for (const { path, evidence } of evidenceRefs(programme)) {
    if (evidence.source_url !== source.url) continue
    console.log(`${quoteOnPage(text, evidence.quote) ? 'on page ' : 'NOT ON PAGE'}  ${path}  "${evidence.quote}"`)
  }
}
