import type { APIRoute } from 'astro'
import { dataJsonSchema } from '../lib/data-docs'

export const GET: APIRoute = () =>
  new Response(JSON.stringify(dataJsonSchema(), null, 2), { headers: { 'Content-Type': 'application/schema+json; charset=utf-8' } })
