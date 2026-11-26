import { describe, expect, test } from 'bun:test'
import type { Programme } from '../../src/data/schema'
import { utcDateKey } from '../../src/lib/status'
import { handleRequest } from './server'

const today = utcDateKey()
const ev = { source_url: 'https://funder.example/call', quote: 'Applications are open all year.', checked_at: today, method: 'page' }
const grant = {
  id: 'one',
  name: 'One grant',
  funder: { name: 'Example Fund', url: 'https://funder.example/' },
  administered_by: null,
  parent: null,
  url: 'https://funder.example/call',
  summary: 'Grants for community groups restoring mangroves.',
  approaches: ['mangroves'],
  applicant_types: ['ngo'],
  geography: { scope: 'global' },
  access: 'direct',
  window: 'rolling',
  amount: null,
  co_finance_required: null,
  reporting: null,
  calls: [{ id: 'c', label: 'Rolling', url: 'https://funder.example/call', status: 'open', opens: null, deadline: null, evidence: { status: ev } }],
  evidence: {},
  checked_at: today,
} as unknown as Programme

const twin = async (id: string) => (id === 'one' ? '# One grant\n\n> “Applications are open all year.”' : null)

async function call(method: string, params: object = {}, programmes = [grant]) {
  const res = await handleRequest(
    new Request('https://mcp.naturefunding.org/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://claude.ai' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    programmes,
    twin,
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as { result: any }).result
}

describe('MCP endpoint', () => {
  test('lists two read-only tools with titles, as both directories require', async () => {
    const { tools } = await call('tools/list')
    expect(tools.map((t: any) => t.name)).toEqual(['search_grants', 'get_grant'])
    for (const t of tools) expect([t.title, t.annotations.readOnlyHint, t.annotations.destructiveHint]).toEqual([t.annotations.title, true, false])
  })

  test('search_grants finds the grant; get_grant adds the listing’s Markdown twin', async () => {
    const found = await call('tools/call', { name: 'search_grants', arguments: { country: 'KE' } })
    expect(found.structuredContent.results.map((r: any) => r.id)).toEqual(['one'])
    const got = await call('tools/call', { name: 'get_grant', arguments: { id: 'one' } })
    expect(got.content[0].text).toContain('"page": "https://naturefunding.org/p/one/"')
    expect(got.content[0].text).toContain('> “Applications are open all year.”')
  })

  test('an unknown id is a helpful error', async () => {
    const got = await call('tools/call', { name: 'get_grant', arguments: { id: 'nope' } })
    expect([got.isError, got.content[0].text]).toEqual([true, 'No listed programme has id "nope". Use search_grants to find ids.'])
  })

  test('an unknown country is an error the assistant can read, not an empty search', async () => {
    const got = await call('tools/call', { name: 'search_grants', arguments: { country: 'UK' } })
    expect([got.isError, got.content[0].text]).toEqual([true, 'Unknown place "UK". Use an ISO 3166 two-letter country code or a region.'])
  })

  test('a deadline closes at its hour in the funder’s zone, judged at the request’s instant', async () => {
    const at = (h: number) => new Date(Date.now() + h * 3_600_000)
    const deadline = (d: Date) => ({ date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), timezone: 'UTC', text: 'x' })
    const call1 = (d: Date) => [{ ...grant.calls[0], deadline: deadline(d) }]
    const soon = { ...grant, id: 'soon', window: 'fixed', calls: call1(at(1)) } as unknown as Programme
    const past = { ...grant, id: 'past', window: 'fixed', calls: call1(at(-1)) } as unknown as Programme
    const found = await call('tools/call', { name: 'search_grants', arguments: { status: 'open' } }, [soon, past])
    expect(found.structuredContent.results.map((r: any) => r.id)).toEqual(['soon'])
  })

  test('a page with no real origin may not call it', async () => {
    const res = await handleRequest(new Request('https://mcp.naturefunding.org/', { method: 'POST', headers: { origin: 'null' }, body: '{}' }), [grant], twin)
    expect(res.status).toBe(403)
  })

  test('a browser opening the address lands on the site; other paths are 404', async () => {
    const page = await handleRequest(new Request('https://mcp.naturefunding.org/', { headers: { accept: 'text/html' } }), [grant], twin)
    expect([page.status, page.headers.get('location')]).toEqual([302, 'https://naturefunding.org/'])
    expect((await handleRequest(new Request('https://mcp.naturefunding.org/x'), [grant], twin)).status).toBe(404)
  })
})
