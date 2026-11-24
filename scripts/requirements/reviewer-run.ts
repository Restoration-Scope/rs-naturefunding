/**
 * Runs one reviewer on a review dir's brief.md and records what it cost. A Cursor model id (`claude-opus-5-5-high`) bills
 * Cursor credits; a `gpt-6…` id runs through `codex exec` on the ChatGPT plan, which reports total tokens only.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Run = { model: string; reported: string; ms: number; exit: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; error?: string }

/** `prompt` is a file in the dir: brief.md, or fix.md for a repair, whose logs get a `.fix` infix. */
export async function runReviewer(dir: string, model: string, prompt = 'brief.md'): Promise<Run> {
  const abs = (f: string) => join(process.cwd(), dir, prompt === 'brief.md' ? f : f.replace('.', `.${prompt.replace('.md', '')}.`))
  const started = Date.now()
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const codex = /^gpt-6/.test(model)
  const [, name, effort] = /^(.*)-(low|medium|high|xhigh|max)$/.exec(model) ?? [null, model, 'high']
  const cmd = codex
    ? ['codex', 'exec', '--skip-git-repo-check', '-m', name!, '-c', `model_reasoning_effort=${effort}`, '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '--ephemeral', '-C', process.cwd(), '-o', abs('reply.md'), '-']
    : ['cursor-agent', '-p', '--output-format', 'stream-json', '--model', model, '--trust', '--force', '--workspace', process.cwd()]
  const proc = Bun.spawn(cmd, { stdin: Bun.file(join(process.cwd(), dir, prompt)), stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), 60 * 60_000)
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  await proc.exited
  writeFileSync(abs('stdout.txt'), out)
  writeFileSync(abs('stderr.txt'), err)
  let reported = ''
  if (codex) {
    reported = /^model: (\S+)/m.exec(err + out)?.[1] ?? ''
    const used = /tokens used\s*\n?\s*([\d,]+)/i.exec(err + out)?.[1]
    if (used) tokens.input = Number(used.replace(/,/g, ''))
  } else {
    for (const line of out.split('\n')) {
      let e: { type?: string; subtype?: string; model?: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } }
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      if (e.type === 'system' && e.subtype === 'init') reported = e.model ?? ''
      if (e.type === 'result' && e.usage) {
        tokens.input += e.usage.inputTokens ?? 0
        tokens.output += e.usage.outputTokens ?? 0
        tokens.cacheRead += e.usage.cacheReadTokens ?? 0
        tokens.cacheWrite += e.usage.cacheWriteTokens ?? 0
      }
    }
  }
  const run: Run = { model, reported, ms: Date.now() - started, exit: proc.exitCode ?? -1, tokens }
  if (run.exit !== 0) run.error = (err || out).slice(-500)
  writeFileSync(abs('run.json'), `${JSON.stringify(run, null, 2)}\n`)
  return run
}
