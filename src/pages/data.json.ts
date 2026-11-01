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
        note: 'Every fact carries evidence: the funder page it was read from, a verbatim quote and the date it was checked. null means the funder’s page does not say.',
        programmes,
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  )
