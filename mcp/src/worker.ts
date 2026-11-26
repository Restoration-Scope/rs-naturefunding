// Cloudflare Worker entry for mcp.naturefunding.org. The macro import runs when Bun bundles this file
// (scripts/build.ts, from the repo root), so the validated programmes ship inside the script: no data fetch for search.
import { searchProgrammes } from '../scripts/programmes' with { type: 'macro' }
import { handleRequest } from './server'

const programmes = searchProgrammes()

export default { fetch: (request: Request) => handleRequest(request, programmes) }
