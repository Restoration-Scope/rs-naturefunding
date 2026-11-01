import type { APIRoute } from 'astro'
import { buildDate, programmes } from '../lib/data'
import { REPO_URL, SITE_URL } from '../lib/site'

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: 'naturefunding.org: grants and funding for nature restoration and conservation',
        url: SITE_URL,
        license: 'CC-BY-4.0',
        attribution: 'naturefunding.org, built by Restoration Scope',
        source: REPO_URL,
        generated_on: buildDate,
        note: 'Each stated fact carries evidence: the page it was read from (the funder’s, or the organisation running the programme), a verbatim quote and the date it was read. null means we did not find it on the pages we read. summary and approaches are our own wording and classification. Quotes are the funders’ words and are not covered by the CC BY licence.',
        programmes,
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  )
