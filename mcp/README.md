# naturefunding MCP server (mcp.naturefunding.org)

A read-only [MCP](https://modelcontextprotocol.io) server over the listings, so AI assistants (Claude connectors, ChatGPT plugins and any other MCP client) can search the directory and quote its evidence. No sign-in.

It runs as its own Cloudflare Worker on its own hostname, so the site stays static assets with no Worker script. The deploy workflow redeploys it after the site on every run, so data changes reach it. Listing drafts: [LISTING.md](LISTING.md). Privacy: https://naturefunding.org/privacy/#ai-assistants (no request logs: `observability` is off in `wrangler.jsonc`).

## Tools

- `search_grants`: filter by the country (ISO code) or region of the work, approach, applicant type and status, plus English query words. One compact row per programme, 40 at a time (`offset` pages). The default status, `worth_a_look`, keeps open, rolling and upcoming calls and yearly windows the funder's page doesn't date for this year; `open` and `any` narrow or widen it. Place matching and status are the finder's own (`placeFit`, `listingFor` with the place), so a search answers what the site's country page shows. `check` names what the reader must confirm (no stated applicant type, or a group of countries the place may be in).
- `get_grant`: one programme's summary (its status from the calls for `country`, when given, as in search), then its Markdown twin (`/p/{id}.md`) read from the site, so the assistant gets the same words, rules and quotes a visitor sees.

Status is judged at the request's instant, so a deadline closes at its hour in the funder's zone. Both tools carry a title and `readOnlyHint`, as both directories require. The server's instructions say how to match a project (country first; `approach` only to narrow), to say "not stated" rather than guess, to give the checked date and link the page, and to credit the data.

## Run

```bash
bun run --cwd mcp dev                  # http://localhost:8788/ over data/ (Bun)
bun test mcp/src
bun mcp/scripts/build.ts               # mcp/dist/worker.js, the Worker that deploys
bunx wrangler dev --config mcp/wrangler.jsonc --port 8788   # the built bundle in workerd
npx @modelcontextprotocol/inspector --cli http://localhost:8788/ --transport http --method tools/list
```

## Shape

- `src/grants.ts`: search and lookup as plain functions over the site's pure modules (`src/lib/listing.ts`, `where-codes.ts`, `format.ts`, `labels.ts`).
- `src/server.ts`: the MCP tools and a stateless web-standard `Request → Response` handler. It answers at `/` and `/mcp`; a browser opening the address is sent to the site.
- `src/worker.ts`: the Worker entry. A Bun macro import runs `scripts/programmes.ts` at bundle time, so the programmes ship inside the script without their evidence (about 600 KB gzipped for 1,071 programmes; the Workers limit is 3 MB on the free plan). `get_grant` takes the evidence from the site's twin, cached at the edge for an hour.
- `src/local.ts`: Bun entry that loads `data/programmes` (run from the repo root).
- The SDK is a root dependency, so CI's one `bun install` covers it.
