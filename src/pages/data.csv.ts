import type { APIRoute } from 'astro'
import { programmes } from '../lib/data'
import { absolute } from '../lib/site'

const columns = [
  'programme_id', 'programme', 'funder', 'administered_by', 'access', 'window', 'call_id', 'call', 'call_status',
  'opens', 'deadline_date', 'deadline_text', 'amount_currency', 'amount_min', 'amount_max', 'amount_typical', 'geography',
  'approaches', 'applicant_types', 'co_finance_required', 'call_url', 'programme_url', 'checked_at', 'listing_url',
] as const

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export const GET: APIRoute = () => {
  const rows = programmes.flatMap((p) => {
    const geo = !p.geography
      ? ''
      : p.geography.scope === 'global'
        ? 'global'
        : p.geography.scope === 'regions'
          ? p.geography.regions.join(' ')
          : p.geography.countries.join(' ')
    const base = {
      programme_id: p.id, programme: p.name, funder: p.funder.name, administered_by: p.administered_by?.name,
      access: p.access, window: p.window, amount_currency: p.amount?.currency, amount_min: p.amount?.min,
      amount_max: p.amount?.max, amount_typical: p.amount?.typical ? 'yes' : '', geography: geo, approaches: p.approaches.join(' '),
      applicant_types: p.applicant_types?.join(' '), co_finance_required: p.co_finance_required,
      programme_url: p.url, checked_at: p.checked_at, listing_url: absolute(`/p/${p.id}/`),
    }
    if (!p.calls.length) return [base]
    return p.calls.map((c) => ({
      ...base, call_id: c.id, call: c.label, call_status: c.status, opens: c.opens,
      deadline_date: c.deadline?.date, deadline_text: c.deadline?.text, call_url: c.url,
    }))
  })
  const body = [columns.join(','), ...rows.map((r) => columns.map((c) => cell((r as Record<string, unknown>)[c])).join(','))]
  return new Response(`${body.join('\n')}\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
}
