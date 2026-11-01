import type { APIRoute } from 'astro'
import { absolute } from '../lib/site'

export const GET: APIRoute = () =>
  new Response(`# Every crawler, search engine and AI agent may read everything here.\n# For agents: ${absolute('/llms.txt')} indexes Markdown copies of every page and the open data.\nUser-agent: *\nAllow: /\n\nSitemap: ${absolute('/sitemap.xml')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
