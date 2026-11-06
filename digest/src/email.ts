// The two emails: the confirmation and the weekly digest. Plain table HTML with inline styles (what mail
// clients render), plus a text version. Colours are the site's tokens (src/styles/global.css).
import type { Call } from '../../src/data/schema'
import { amountText, geographyText, longDate } from '../../src/lib/format'
import type { Digest, DigestItem, Section } from './digest'
import { prefsText, type Prefs } from './match'

const C = { paper: '#f7f4ef', linen: '#edeae7', ink: '#1b2722', ink2: '#565e5b', brand: '#3a7e49', shell: '#254b36', shellInk2: '#beccc2', rule: '#d8d7d2' }
const SANS = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
const SERIF = "'Geist Serif', Georgia, 'Times New Roman', serif"

export type Email = { subject: string; html: string; text: string }

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const RS_URL = 'https://restorationscope.com/?utm_source=naturefunding&utm_medium=email&utm_campaign=digest'
const TAGLINE = 'naturefunding.org is free and neutral: funders can’t pay to be listed. Built with 💚 by Restoration Scope.'
const taglineHtml = esc(TAGLINE).replace('Restoration Scope', `<a href="${RS_URL}" style="color:${C.ink2};">Restoration Scope</a>`)

/** The country's flag before its name, when the person chose a country (PNG: Gmail and Outlook don't show SVG). */
const flag = (site: string, prefs: Prefs) =>
  prefs.where && !prefs.where.startsWith('r:')
    ? `<img src="${esc(site)}/flags/${esc(prefs.where)}.png" width="21" height="14" alt="" style="display:inline-block;vertical-align:-2px;margin-right:5px;border:0;border-radius:2px;">`
    : ''

function frame(site: string, preheader: string, body: string, footer?: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>naturefunding.org</title></head>
<body style="margin:0;padding:0;background:${C.linen};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.linen};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.rule};border-radius:8px;overflow:hidden;">
<tr><td style="background:${C.shell};padding:18px 28px;">
<a href="${esc(site)}/" style="font-family:${SERIF};font-size:22px;color:${C.paper};text-decoration:none;">naturefunding<span style="color:${C.shellInk2};">.org</span></a>
</td></tr>
<tr><td style="padding:28px 28px 8px;font-family:${SANS};font-size:16px;line-height:1.5;color:${C.ink};">${body}</td></tr>
${footer ? `<tr><td style="padding:20px 28px 28px;font-family:${SANS};font-size:13px;line-height:1.5;color:${C.ink2};border-top:1px solid ${C.rule};">${footer}</td></tr>` : ''}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td align="center" style="padding:14px 28px 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.ink2};">${taglineHtml}</td></tr></table>
</td></tr></table>
</body></html>`
}

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${C.brand};border-radius:6px;"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a></td></tr></table>`

export function confirmationEmail(o: { site: string; confirmUrl: string; prefs: Prefs }): Email {
  const what = prefsText(o.prefs)
  const lead = `Press the button to start getting new nature funding calls by email${what ? ` for ${what}` : ''}: at most one email a week, and only when there is something new.`
  const leadHtml = what ? esc(lead).replace(` for ${esc(what)}`, ` for ${flag(o.site, o.prefs)}${esc(what)}`) : esc(lead)
  const html = frame(
    o.site,
    'One click to start your weekly naturefunding.org email.',
    `<h1 style="margin:0 0 12px;font-family:${SERIF};font-size:26px;font-weight:400;">Confirm your email</h1>
<p style="margin:0;">${leadHtml}</p>
${button(o.confirmUrl, 'Confirm my email')}
<p style="margin:0 0 16px;color:${C.ink2};font-size:14px;">The link works for 3 days. If you didn’t ask for this, ignore this email and we won’t write again.</p>`,
  )
  const text = `Confirm your email\n\n${lead}\n\nConfirm: ${o.confirmUrl}\n\nThe link works for 3 days. If you didn't ask for this, ignore this email and we won't write again.\n\n--\n${TAGLINE}\n`
  return { subject: 'Confirm your weekly naturefunding.org email', html, text }
}

const sectionTitle: Record<Section, string> = {
  open: 'Open now',
  upcoming: 'Opening soon',
  new: 'New on naturefunding.org',
}

function callLine(call: Call | null, section: Section): string {
  if (!call) return 'No open call right now'
  if (call.status === 'open') return call.deadline ? `Open · deadline ${call.deadline.text}` : 'Open · no deadline stated'
  if (call.status === 'upcoming') {
    if (call.opens) return `Opens ${longDate(call.opens)}`
    return call.expected ? `Expected to open ${call.expected}` : 'Opening date not stated yet'
  }
  return section === 'new' ? 'No open call right now' : ''
}

function itemParts(i: DigestItem, site: string) {
  const p = i.programme
  const facts = [amountText(p.amount), geographyText(p.geography)].filter(Boolean) as string[]
  return {
    name: p.name,
    funder: p.funder.name,
    status: callLine(i.call, i.section),
    live: i.call?.status === 'open' || i.call?.status === 'upcoming',
    callLabel: i.call?.label ?? null,
    facts,
    page: `${site}/p/${p.id}/`,
    callUrl: i.call?.url ?? p.url,
  }
}

export function digestEmail(o: { site: string; digest: Digest; prefs: Prefs; since: string; unsubscribeUrl: string; manageUrl: string }): Email {
  const { items, total } = o.digest
  const what = prefsText(o.prefs)
  const counts = (['open', 'upcoming', 'new'] as Section[]).map((s) => [s, items.filter((i) => i.section === s).length] as const)
  const subjectBits = (Object.entries(o.digest.counts) as [Section, number][]).filter(([, n]) => n > 0).map(([s, n]) =>
    s === 'open' ? plural(n, 'call open', 'calls open') : s === 'upcoming' ? plural(n, 'call opening soon', 'calls opening soon') : plural(n, 'new programme', 'new programmes'),
  )
  const subject = `${subjectBits.join(', ')}${what ? ` · ${what}` : ''}`
  const intro = `New since ${longDate(o.since.slice(0, 10))}${what ? `, for ${what}` : ''}.`
  const introHtml = what ? esc(intro).replace(`, for ${esc(what)}`, `, for ${flag(o.site, o.prefs)}${esc(what)}`) : esc(intro)

  const sections = counts
    .filter(([, n]) => n > 0)
    .map(([s]) => {
      const rows = items
        .filter((i) => i.section === s)
        .map((i) => {
          const x = itemParts(i, o.site)
          return `<tr><td style="padding:14px 0;border-top:1px solid ${C.rule};">
<a href="${esc(x.page)}" style="font-size:17px;font-weight:600;color:${C.ink};text-decoration:underline;text-decoration-color:${C.rule};">${esc(x.name)}</a>
<div style="font-size:14px;color:${C.ink2};margin-top:2px;">${esc(x.funder)}</div>
<div style="font-size:15px;margin-top:8px;">${x.live ? `<strong style="color:${C.brand};font-weight:600;">${esc(x.status)}</strong>` : `<span style="color:${C.ink2};">${esc(x.status)}</span>`}${x.callLabel ? ` <span style="color:${C.ink2};">· ${esc(x.callLabel)}</span>` : ''}</div>
${x.facts.length ? `<div style="font-size:14px;color:${C.ink2};margin-top:4px;">${esc(x.facts.join(' · '))}</div>` : ''}
<div style="font-size:14px;margin-top:8px;"><a href="${esc(x.callUrl)}" style="color:${C.brand};">Funder’s page</a> <span style="color:${C.rule};">|</span> <a href="${esc(x.page)}" style="color:${C.brand};">Details and evidence</a></div>
</td></tr>`
        })
        .join('')
      return `<h2 style="margin:24px 0 4px;font-family:${SERIF};font-size:20px;font-weight:400;">${sectionTitle[s]}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${SANS};">${rows}</table>`
    })
    .join('')

  const more = total > items.length ? `<p style="margin:20px 0 0;">And ${total - items.length} more. <a href="${esc(o.site)}/" style="color:${C.brand};">See them all on naturefunding.org</a>.</p>` : ''
  const body = `<p style="margin:0;color:${C.ink2};font-size:15px;">${introHtml}</p>${sections}${more}
<p style="margin:24px 0 16px;font-size:14px;color:${C.ink2};">Each listing is checked against the funder’s own page. Dates and amounts are as the funder states them; check the funder’s page before you apply.</p>`
  const footer = `You get this because you signed up at naturefunding.org${what ? ` for ${esc(what)}` : ''}. At most one email a week, only when something is new.<br>
<a href="${esc(o.manageUrl)}" style="color:${C.ink2};">Change what you get</a> · <a href="${esc(o.unsubscribeUrl)}" style="color:${C.ink2};">Unsubscribe</a>`

  const textItems = counts
    .filter(([, n]) => n > 0)
    .map(([s]) =>
      [
        sectionTitle[s].toUpperCase(),
        ...items
          .filter((i) => i.section === s)
          .map((i) => {
            const x = itemParts(i, o.site)
            return [`- ${x.name} (${x.funder})`, `  ${x.status}${x.callLabel ? ` · ${x.callLabel}` : ''}`, ...(x.facts.length ? [`  ${x.facts.join(' · ')}`] : []), `  ${x.page}`].join('\n')
          }),
      ].join('\n\n'),
    )
    .join('\n\n')
  const text = `${intro}\n\n${textItems}\n${total > items.length ? `\nAnd ${total - items.length} more: ${o.site}/\n` : ''}\nDates and amounts are as the funder states them; check the funder's page before you apply.\n\n--\nAt most one email a week, only when something is new.\nChange what you get: ${o.manageUrl}\nUnsubscribe: ${o.unsubscribeUrl}\n\n${TAGLINE}\n`
  return { subject, html: frame(o.site, intro, body, footer), text }
}
