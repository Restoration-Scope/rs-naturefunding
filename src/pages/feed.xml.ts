import type { APIRoute } from 'astro'
import { buildDate, listings } from '../lib/data'
import { longDate } from '../lib/format'
import { absolute } from '../lib/site'

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const statusText: Record<string, string> = {
  open: 'Open', upcoming: 'Upcoming', closed: 'Closed', suspended: 'Suspended', unknown: 'Status unclear',
}

/**
 * One entry per call state. The id includes the status and deadline, so a call that opens, closes or
 * moves its deadline shows up as a new entry in feed readers.
 */
export const GET: APIRoute = () => {
  const entries = listings
    .flatMap(({ p }) => p.calls.map((c) => ({ p, c })))
    .map(({ p, c }) => {
      const updated = c.evidence.deadline?.checked_at ?? c.evidence.status.checked_at
      const title = `${statusText[c.status]}: ${p.name}, ${c.label}${c.deadline ? ` (deadline ${c.deadline.text})` : ''}`
      const summary = [
        `${p.funder.name}.`,
        c.opens ? `Opens ${longDate(c.opens)}.` : '',
        c.deadline ? `Deadline as the funder wrote it: ${c.deadline.text}.` : '',
        `Checked against ${c.url} on ${longDate(c.evidence.status.checked_at)}.`,
      ].filter(Boolean).join(' ')
      return {
        id: `tag:naturefunding.org,2026:${p.id}/${c.id}/${c.status}/${c.deadline?.date ?? 'none'}`,
        updated,
        xml: `  <entry>
    <id>${esc(`tag:naturefunding.org,2026:${p.id}/${c.id}/${c.status}/${c.deadline?.date ?? 'none'}`)}</id>
    <title>${esc(title)}</title>
    <link href="${esc(absolute(`/p/${p.id}/`))}"/>
    <updated>${updated}T00:00:00Z</updated>
    <summary>${esc(summary)}</summary>
  </entry>`,
      }
    })
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 100)

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>naturefunding.org: calls and their status</title>
  <subtitle>Every call with its current status. A call that opens, closes or moves its deadline appears as a new entry.</subtitle>
  <id>${absolute('/')}</id>
  <link rel="self" href="${absolute('/feed.xml')}"/>
  <link href="${absolute('/')}"/>
  <updated>${entries[0]?.updated ?? buildDate}T00:00:00Z</updated>
  <author><name>naturefunding.org (Restoration Scope)</name></author>
  <rights>CC BY 4.0</rights>
${entries.map((e) => e.xml).join('\n')}
</feed>
`
  return new Response(xml, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } })
}
