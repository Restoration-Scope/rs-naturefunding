import type { APIRoute } from 'astro'
import { homeMarkdown } from '../lib/agent'
import { listings } from '../lib/data'

export const GET: APIRoute = () =>
  new Response(homeMarkdown(listings), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
