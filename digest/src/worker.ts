// Cloudflare Worker entry for email.naturefunding.org. The macro imports run when Bun bundles this file
// (scripts/build.ts, from the repo root): the validated programmes and the events read from git history ship
// inside the script, so a data change needs a redeploy, which the deploy workflow does on every run.
import { loadProgrammes } from '../../src/data/load' with { type: 'macro' }
import { coveredUntil, eventsFromHistory } from '../scripts/history' with { type: 'macro' }
import { handle, runDigest, type Deps, type Env } from './app'

const deps: Deps = {
  programmes: new Map(loadProgrammes().map((p) => [p.id, p])),
  events: eventsFromHistory(),
  coveredUntil: coveredUntil(),
}

export default {
  fetch: (request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => handle(request, env, deps, ctx),
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => ctx.waitUntil(runDigest(env, deps)),
}
