import type { APIRoute } from 'astro'
import { llmsTxt } from '../lib/agent'
import { listings } from '../lib/data'

export const GET: APIRoute = () =>
  new Response(llmsTxt(listings), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
