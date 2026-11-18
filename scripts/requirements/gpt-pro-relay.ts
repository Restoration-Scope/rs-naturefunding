/**
 * A localhost relay for the chatgpt.com tab: GET /prompt/<id> serves a prompt file, POST /answer/<id> stores the
 * answer text, so neither passes through an agent's context. Bound to 127.0.0.1; only these two routes.
 *   bun scripts/requirements/gpt-pro-relay.ts   (port 8765, files in .cache/gpt-pro/)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), '.cache', 'gpt-pro')
const ID = /^[a-z0-9-]{1,120}$/
const cors = { 'Access-Control-Allow-Origin': 'https://chatgpt.com', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Private-Network': 'true' }

Bun.serve({
  hostname: '127.0.0.1',
  port: 8765,
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    const [, kind, id] = new URL(req.url).pathname.split('/')
    if (!id || !ID.test(id)) return new Response('bad id', { status: 400, headers: cors })
    if (req.method === 'GET' && kind === 'prompt') {
      const f = join(DIR, 'prompts', `${id}.txt`)
      return existsSync(f) ? new Response(readFileSync(f, 'utf8'), { headers: cors }) : new Response('no prompt', { status: 404, headers: cors })
    }
    if (req.method === 'POST' && kind === 'answer') {
      writeFileSync(join(DIR, 'answers', `${id}.json`), await req.text())
      return new Response('ok', { headers: cors })
    }
    return new Response('not found', { status: 404, headers: cors })
  },
})
console.log('relay on http://127.0.0.1:8765')
