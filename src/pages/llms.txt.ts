import type { APIRoute } from 'astro'
import { llmsTxt } from '../lib/agent'
import { listings } from '../lib/data'
import { finderPages } from '../lib/finder-pages'

export const GET: APIRoute = () =>
  new Response(llmsTxt(listings, Object.values(finderPages).flat()), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
