import type { APIRoute } from 'astro'
import { llmsFullTxt } from '../lib/agent'
import { listings } from '../lib/data'

export const GET: APIRoute = () =>
  new Response(llmsFullTxt(listings), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
