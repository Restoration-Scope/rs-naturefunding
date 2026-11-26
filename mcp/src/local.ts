// Local entry: serves the MCP endpoint at http://localhost:<PORT>/ (and /mcp) from the programme files in data/.
import { loadProgrammes } from '../../src/data/load'
import { handleRequest } from './server'

const programmes = loadProgrammes()
const port = Number(process.env.PORT ?? 8788)

Bun.serve({ port, hostname: '127.0.0.1', fetch: (request) => handleRequest(request, programmes) })

console.log(`naturefunding MCP: ${programmes.length} programmes at http://localhost:${port}/`)
