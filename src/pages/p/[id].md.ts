import type { APIRoute, GetStaticPaths } from 'astro'
import type { Programme } from '../../data/schema'
import { programmeMarkdown } from '../../lib/agent'
import { programmes } from '../../lib/data'
import { longDate } from '../../lib/format'

export const getStaticPaths = (() => programmes.map((p) => ({ params: { id: p.id }, props: { p } }))) satisfies GetStaticPaths

/** Where the funder names the countries or parts, when that is not the quote the place rests on. */
function placesSection(p: Programme): string {
  const quotes = (p.evidence.places ?? []).map((q) => `> “${q.quote}”\n\nSource: ${q.source_url}, checked ${longDate(q.checked_at)}.`)
  return quotes.length ? `\n## Where the places are named\n\n${quotes.join('\n\n')}\n` : ''
}

export const GET: APIRoute = ({ props }) => {
  const { p } = props as { p: Programme }
  return new Response(programmeMarkdown(p) + placesSection(p), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
