import type { APIRoute } from 'astro'
import { listings, programmes, stats } from '../lib/data'
import type { RunReport } from '../../scripts/refresh/state'

// Written by the daily refresh job (scripts/refresh/state.ts); absent until its first run.
const runs = import.meta.glob<RunReport>('/data/checks/run.json', { eager: true, import: 'default' })
const run: RunReport | null = Object.values(runs)[0] ?? null

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        refreshed_at: run?.run_at ?? null,
        run_url: run?.run_url ?? null,
        built_at: new Date().toISOString(),
        sources: run?.sources ?? null,
        calls_closed: run?.calls_closed ?? null,
        programmes: programmes.length,
        listed: listings.length,
        stale_over_30_days: run?.programmes.stale_over_30_days ?? listings.filter((l) => l.aging).length,
        open_calls: stats.openCalls,
        last_checked: stats.lastChecked,
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  )
