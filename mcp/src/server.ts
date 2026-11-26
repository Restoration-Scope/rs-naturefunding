// The MCP server: two read-only tools over the programmes, answered over Streamable HTTP with web-standard
// Request/Response, so the same handler runs under Bun locally and on a Cloudflare Worker.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { approach, applicantType, type Programme } from '../../src/data/schema'
import { SITE_URL } from '../../src/lib/site'
import { regionLabels, type Region } from '../../src/lib/geo'
import { DEFAULT_LIMIT, MAX_LIMIT, getGrant, searchGrants, twinUrl } from './grants'

const INSTRUCTIONS = `naturefunding.org is a free, neutral directory of grants for nature restoration and conservation, built by Restoration Scope.
Every fact comes from the funder's own page, with a verbatim quote and the date it was checked.
- A field that is missing or null means the pages we read don't say: write "not stated". Never guess a deadline, amount or eligibility.
- \`check\` lists what the reader must confirm: filters a programme passed only because the funder doesn't say, or a group of countries theirs may be in.
- Status is as of \`checked_at\`, not guaranteed today. Few or no results doesn't mean no funding exists: we list a limited set.
- To match a project: search by its country first. approach keeps only programmes that name that approach, and most general conservation funds don't, so add it only to narrow a long list.
- Then drop programmes the project clearly fails, read the best few with get_grant, then give each one's deadline, amount, the rules it meets and fails, and how to apply. End with the questions whose answers would change the list.
- Give the date we checked and link the naturefunding.org page (\`page\`) so the reader can see the funder's own words.
- Remind the reader to confirm on the funder's page before applying.
- Answer in the reader's language; search in English (programme names and summaries are in English).
- Credit "naturefunding.org (Restoration Scope)": the data is CC BY 4.0; quotes are the funders' words.`

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

/** The site's Markdown twin of /p/{id}/, or null when it can't be read. Cached at Cloudflare's edge for an hour. */
export type ReadTwin = (id: string) => Promise<string | null>
export const fetchTwin: ReadTwin = async (id) => {
  try {
    const res = await fetch(twinUrl(id), { cf: { cacheTtl: 3600 } } as RequestInit)
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

/** `now`: the request's instant, so a deadline at 17:00 in the funder's zone closes at 17:00, not at a day's noon. */
export function createServer(programmes: Programme[], now: string | Date = new Date(), readTwin: ReadTwin = fetchTwin): McpServer {
  const server = new McpServer({ name: 'naturefunding', version: '0.2.0', websiteUrl: SITE_URL }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'search_grants',
    {
      title: 'Search nature restoration grants',
      description:
        `Use this when someone looks for grants or funding for a nature restoration or conservation project. Filter by the country of the work, approach and applicant type; open calls come first (soonest deadline first), then rolling, upcoming and yearly windows. One line per programme, ${DEFAULT_LIMIT} at a time; use offset for more.`,
      inputSchema: {
        query: z.string().max(200).optional().describe('Words to look for in English, e.g. "mangroves Kenya" or "seed fund for women-led groups".'),
        country: z.string().regex(/^[A-Za-z]{2}$/).optional().describe('ISO 3166 two-letter code of the country where the work happens, e.g. KE.'),
        approach: approach.optional().describe('Keeps only programmes that name this approach. General conservation funds often name none, so leave it out unless the list is long.'),
        applicant_type: applicantType.optional().describe('Who applies.'),
        region: z
          .enum(Object.keys(regionLabels) as [Region, ...Region[]])
          .optional()
          .describe('A whole region, when there is no single country. Ignored when country is given.'),
        status: z
          .enum(['open', 'worth_a_look', 'any'])
          .optional()
          .describe(
            "open: taking applications today. worth_a_look (default): also announced calls and yearly windows the funder's page doesn't date for this year. any: also closed and no-call programmes.",
          ),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many results, ${DEFAULT_LIMIT} by default.`),
        offset: z.number().int().min(0).optional().describe('Skip this many results, to page through them.'),
      },
      annotations: { title: 'Search nature restoration grants', ...readOnly },
    },
    async (input) => {
      const found = searchGrants(programmes, input, now)
      if (found.error) return { isError: true, content: [{ type: 'text', text: found.error }] }
      const text =
        found.total === 0
          ? 'No programme matches. Try fewer filters, status "any", or no query.'
          : JSON.stringify(found)
      return { content: [{ type: 'text', text }], structuredContent: found }
    },
  )

  server.registerTool(
    'get_grant',
    {
      title: 'Get one grant with its evidence',
      description:
        "Use this to read one programme in full before recommending it: eligibility rules, amount, calls and deadlines, how to apply and what applying asks for, each with the funder's page, verbatim quote and date checked. Takes an id from search_grants.",
      inputSchema: {
        id: z.string().max(120).describe('Programme id from search_grants, e.g. "darwin-initiative-main".'),
        country: z.string().regex(/^[A-Za-z]{2}$/).optional().describe('The country of the work, as in search_grants: calls for that place set the status.'),
      },
      annotations: { title: 'Get one grant with its evidence', ...readOnly },
    },
    async ({ id, country }) => {
      const grant = getGrant(programmes, id, now, { country })
      if (!grant) return { isError: true, content: [{ type: 'text', text: `No listed programme has id "${id}". Use search_grants to find ids.` }] }
      // The listing's Markdown twin, as the site publishes it: the same words and quotes a reader sees on the page.
      const twin = await readTwin(id)
      const head = JSON.stringify(grant, null, 1)
      if (!twin) return { content: [{ type: 'text', text: `${head}\n\nThe full listing could not be read just now; it is at ${grant.page}` }] }
      return { content: [{ type: 'text', text: `${head}\n\nThe full listing, for every place it covers:\n\n${twin}` }] }
    },
  )

  return server
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
}

/** The endpoint answers at / (the address people paste, mcp.naturefunding.org) and /mcp; a browser lands on the site. */
export function handleRequest(request: Request, programmes: Programme[], readTwin: ReadTwin = fetchTwin): Response | Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname !== '/' && pathname !== '/mcp') return new Response('Not found', { status: 404 })
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) return Response.redirect(`${SITE_URL}/`, 302)
  return handleMcp(request, programmes, readTwin)
}

/** Stateless: a fresh server and transport per request, JSON responses, no sessions to keep. */
export async function handleMcp(request: Request, programmes: Programme[], readTwin: ReadTwin = fetchTwin): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  // Anyone may read this public data (CORS *), but a page with no real origin (sandboxed, file://) may not call it.
  const origin = request.headers.get('origin')
  if (origin !== null && !/^https?:\/\/[^/]+$/.test(origin)) return new Response('Forbidden origin', { status: 403, headers: cors })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await createServer(programmes, new Date(), readTwin).connect(transport)
  const response = await transport.handleRequest(request)
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(cors)) headers.set(k, v)
  return new Response(response.body, { status: response.status, headers })
}
