// The two emails: the confirmation and the weekly digest. Plain table HTML with inline styles (what mail
// clients render), plus a text version. Colours are the site's tokens (src/styles/global.css).
import type { Call } from '../../src/data/schema'
import { amountShort, geographyText, longDate } from '../../src/lib/format'
import { ratesDate } from '../../src/lib/rates'
import { countryName, regionLabels, type Region } from '../../src/lib/geo'
import { approachLabels, projectTypes } from '../../src/lib/labels'
import { markFor } from '../../src/lib/marks'
import { pageHref, type PagePaths } from '../../src/lib/page-paths'
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
// The sender's postal address, which anti-spam law (CAN-SPAM) asks of every email: the company's mailing address.
export const POSTAL_ADDRESS = 'Restoration Scope LLC, 411 Walnut Street #24052, Green Cove Springs, FL 32043, USA'
const taglineHtml = esc(TAGLINE).replace('Restoration Scope', `<a href="${RS_URL}" style="color:${C.ink2};">Restoration Scope</a>`)

// Icons in the "for …" line, served from the site as PNG (Gmail and Outlook don't show SVG): the country's flag
// (public/flags/), the region's land or the project type's finder icon (public/icons/, scripts/images/email-icons.ts).
const typeOf = Object.fromEntries(projectTypes.flatMap((t) => t.approaches.map((a) => [a, t.key])))
const icon = (src: string, w: number, h: number, radius = 0) =>
  `<img src="${esc(src)}" width="${w}" height="${h}" alt="" style="display:inline-block;vertical-align:-2px;margin-right:4px;border:0;${radius ? `border-radius:${radius}px;` : ''}">`

/** The icon stays on the same line as the label's first word; the rest of a long label can still wrap. */
const withIcon = (img: string, label: string) => {
  const [first, ...rest] = esc(label).split(' ')
  return `<span style="white-space:nowrap;">${img}${first}</span>${rest.length ? ` ${rest.join(' ')}` : ''}`
}

/** prefsText with an icon before each part: "[flag] Kenya · [waves] Mangroves or [drops] Wetlands". */
function prefsHtml(site: string, prefs: Prefs): string {
  const where = !prefs.where
    ? null
    : prefs.where.startsWith('r:')
      ? withIcon(icon(`${site}/icons/regions/${prefs.where.slice(2)}.png`, 16, 16), regionLabels[prefs.where.slice(2) as Region])
      : withIcon(icon(`${site}/flags/${prefs.where}.png`, 21, 14, 2), countryName(prefs.where))
  const what = prefs.approaches.length
    ? prefs.approaches.map((a) => withIcon(icon(`${site}/icons/types/${typeOf[a]}.png`, 16, 16), approachLabels[a])).join(' or ')
    : null
  return [where, what].filter(Boolean).join(' · ')
}

/** The funder's favicon (public/icons/marks/, a PNG copy of public/marks/), or its monogram in a muted square. */
function funderMark(site: string, org: { name: string; url: string }) {
  const m = markFor(org)
  if (m.kind === 'icon') return icon(`${site}/icons/marks/${m.domain}.png`, 16, 16, 3)
  return `<span style="display:inline-block;width:16px;height:16px;line-height:16px;margin-right:4px;vertical-align:-2px;border-radius:3px;background:${C.linen};color:${C.ink2};font-size:8px;font-weight:600;text-align:center;">${esc(m.letters)}</span>`
}

/** "US dollars", for "amounts in US dollars". */
export const currencyName = (code: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'name' }).formatToParts(2).find((p) => p.type === 'currency')?.value ?? code

/** The site's page for the subscriber's choices: their country's (or region's, or type's) page, with any choice
 *  no page holds left in the address (src/lib/page-paths.ts, src/lib/finder.ts fromUrl). Without the page map,
 *  the home finder with both choices in the address. */
export function finderUrl(site: string, prefs: Prefs, pages: PagePaths = {}) {
  return `${site}${pageHref(pages, prefs.where, [...prefs.approaches].sort().join(' '))}`
}

const PAD = 28
/** A full-width row of the email, its content inside the gutter. */
const row = (html: string, o: { top?: number; bottom?: number } = {}) =>
  `<tr><td style="padding:${o.top ?? 16}px ${PAD}px ${o.bottom ?? 16}px;font-family:${SANS};font-size:16px;line-height:1.5;color:${C.ink};">${html}</td></tr>`

/** One grant as a white card on the paper band: rounded, with a soft shadow where the mail client shows one. */
const card = (html: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;background:#ffffff;border:1px solid ${C.rule};border-radius:10px;box-shadow:0 1px 2px rgba(27,39,34,0.05),0 3px 10px rgba(27,39,34,0.05);"><tr><td style="padding:16px 18px;font-family:${SANS};font-size:16px;line-height:1.5;color:${C.ink};">${html}</td></tr></table>`

/** rows: the card's rows (row()), between the header and the footer. */
function frame(site: string, preheader: string, rows: string, footer?: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>naturefunding.org</title></head>
<body style="margin:0;padding:0;background:${C.linen};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.linen};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.rule};border-radius:8px;overflow:hidden;">
<tr><td style="background:${C.shell};padding:18px 28px;">
<a href="${esc(site)}/" style="font-family:${SERIF};font-size:22px;color:${C.paper};text-decoration:none;">naturefunding<span style="color:${C.shellInk2};">.org</span></a>
</td></tr>
${rows}
${footer ? `<tr><td style="padding:20px 28px 28px;font-family:${SANS};font-size:13px;line-height:1.5;color:${C.ink2};border-top:1px solid ${C.rule};">${footer}</td></tr>` : ''}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td align="center" style="padding:14px 28px 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.ink2};">${taglineHtml}<br>${esc(POSTAL_ADDRESS)}</td></tr></table>
</td></tr></table>
</body></html>`
}

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${C.brand};border-radius:6px;"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a></td></tr></table>`

export function confirmationEmail(o: { site: string; confirmUrl: string; prefs: Prefs; currency?: string }): Email {
  const what = prefsText(o.prefs)
  const inCurrency = o.currency ? `, with amounts in ${currencyName(o.currency)}` : ''
  const lead = `Press the button to start getting new nature funding calls by email${what ? ` for ${what}` : ''}${inCurrency}: at most one email a week, and only when there is something new.`
  const leadHtml = what ? esc(lead).replace(` for ${esc(what)}`, ` for ${prefsHtml(o.site, o.prefs)}`) : esc(lead)
  const html = frame(
    o.site,
    'One click to start your weekly naturefunding.org email.',
    row(`<h1 style="margin:0 0 12px;font-family:${SERIF};font-size:26px;font-weight:400;">Confirm your email</h1>
<p style="margin:0;">${leadHtml}</p>
${button(o.confirmUrl, 'Confirm my email')}
<p style="margin:0 0 16px;color:${C.ink2};font-size:14px;">The link works for 3 days. If you didn’t ask for this, ignore this email and we won’t write again.</p>`, { top: 28, bottom: 8 }),
  )
  const text = `Confirm your email\n\n${lead}\n\nConfirm: ${o.confirmUrl}\n\nThe link works for 3 days. If you didn't ask for this, ignore this email and we won't write again.\n\n--\n${TAGLINE}\n${POSTAL_ADDRESS}\n`
  return { subject: 'Confirm your weekly naturefunding.org email', html, text }
}

/** "6 calls open, 1 call opening soon, 344 new programmes": the subject, and each past issue's line on the site. */
export const countsText = (counts: Digest['counts']) =>
  (Object.entries(counts) as [Section, number][])
    .filter(([, n]) => n > 0)
    .map(([s, n]) =>
      s === 'open' ? plural(n, 'call open', 'calls open') : s === 'upcoming' ? plural(n, 'call opening soon', 'calls opening soon') : plural(n, 'new programme', 'new programmes'),
    )
    .join(', ')

export const sectionTitle: Record<Section, string> = {
  open: 'Open now',
  upcoming: 'Opening soon',
  new: 'New on naturefunding.org',
}

/** Only a live call gets a line: an item with no open or announced call says nothing about it. */
function callLine(call: Call | null): string {
  if (!call) return ''
  if (call.status === 'open') return call.deadline ? `Open · deadline ${call.deadline.text}` : 'Open · no deadline stated'
  if (call.status === 'upcoming') {
    if (call.opens) return `Opens ${longDate(call.opens)}`
    return call.expected ? `Expected to open ${call.expected}` : 'Opening date not stated yet'
  }
  return ''
}

/** Where the listing is open. Left out when the subscriber chose a country: the email's heading already names it. */
function placeOf(i: DigestItem, prefs: Prefs) {
  const country = prefs.where && !prefs.where.startsWith('r:')
  return country ? '' : geographyText(i.programme.geography)
}

/** One item's parts, shared by the email and the past issues on the site (src/components/DigestIssue.astro). */
export function itemParts(i: DigestItem, site: string, prefs: Prefs, currency?: string) {
  const p = i.programme
  const status = callLine(i.call)
  return {
    name: p.name,
    // Left out when the programme's name already says it ("11th Hour Racing grants" by 11th Hour Racing).
    funder: p.name.toLowerCase().includes(p.funder.name.toLowerCase()) ? null : p.funder.name,
    mark: funderMark(site, p.funder),
    status,
    callLabel: status ? (i.call?.label ?? null) : null,
    amount: amountShort(p.amount, currency),
    place: placeOf(i, prefs),
    // The project types it funds, with the finder's icons. Left out when the subscriber chose a type: the heading names it.
    types: prefs.approaches.length ? [] : projectTypes.filter((t) => t.approaches.some((a) => p.approaches.includes(a))).map((t) => ({ key: t.key, label: t.label })),
    page: `${site}/p/${p.id}/`,
  }
}

export function digestEmail(o: { site: string; pages?: PagePaths; digest: Digest; prefs: Prefs; currency?: string; since: string; unsubscribeUrl: string; manageUrl: string }): Email {
  const { items, total } = o.digest
  const what = prefsText(o.prefs)
  const counts = (['open', 'upcoming', 'new'] as Section[]).map((s) => [s, items.filter((i) => i.section === s).length] as const)
  const subject = `${countsText(o.digest.counts)}${what ? ` · ${what}` : ''}`
  const sinceText = `since ${longDate(o.since.slice(0, 10))}`
  const intro = `New${what ? ` for ${what}` : ''} ${sinceText}`
  const listUrl = finderUrl(o.site, o.prefs, o.pages)
  const link = (label: string) => `<a href="${esc(listUrl)}" style="color:${C.brand};">${label}</a>`
  const introHtml = `New${what ? ` for ${link(prefsHtml(o.site, o.prefs))}` : ''} ${esc(sinceText)}`
  // One section needs no heading of its own: the email's heading already says what it is.
  const shown = counts.filter(([, n]) => n > 0)
  const headed = shown.length > 1

  const fineprint = o.currency
    ? `Amounts are converted to ${currencyName(o.currency)} at the rates of ${longDate(ratesDate)}, with the funder’s own figure in brackets. Check the funder’s page before you apply.`
    : 'Amounts are as the funder states them. Check the funder’s page before you apply.'
  const sections = shown
    .map(([s]) => {
      const rows = items
        .filter((i) => i.section === s)
        .map((i) => {
          const x = itemParts(i, o.site, o.prefs, o.currency)
          const amount = x.amount
            ? `<strong style="font-weight:700;color:${C.ink};">${esc(x.amount.text)}</strong>${x.amount.original ? `<span style="font-size:15px;color:${C.ink2};"> (${esc(x.amount.original)})</span>` : ''}`
            : `<span style="font-size:18px;color:${C.ink2};">Amount not stated</span>`
          // The title is the item's one link: our listing, which links on to the funder's page and the evidence.
          const title = `${x.mark}<a href="${esc(x.page)}" style="color:${C.ink};text-decoration:underline;text-decoration-color:${C.ink2};">${esc(x.name)}</a>`
          return card(
            `<div style="font-size:18px;line-height:1.35;">${title}${x.funder ? `<span style="font-size:15px;color:${C.ink2};"> · ${esc(x.funder)}</span>` : ''}</div>
<div style="font-size:24px;line-height:1.25;margin-top:6px;">${amount}</div>
${x.place ? `<div style="font-size:15px;color:${C.ink2};margin-top:4px;">${esc(x.place)}</div>` : ''}
${x.types.length ? `<div style="font-size:14px;color:${C.ink2};margin-top:6px;">${x.types.map((t) => withIcon(icon(`${o.site}/icons/types/${t.key}.png`, 16, 16), t.label)).join('<span style="color:#c4c3be;">&nbsp; · &nbsp;</span>')}</div>` : ''}
${x.status ? `<div style="font-size:15px;margin-top:6px;"><strong style="color:${C.brand};font-weight:600;">${esc(x.status)}</strong>${x.callLabel ? ` <span style="color:${C.ink2};">· ${esc(x.callLabel)}</span>` : ''}</div>` : ''}`,
          )
        })
        .join('')
      return (headed ? `<h2 style="margin:6px 4px 10px;font-size:15px;font-weight:600;color:${C.ink2};">${sectionTitle[s]}</h2>` : '') + rows
    })
    .join('')
  // The cards float on a paper band that runs the card's full width.
  const band = `<tr><td style="background:${C.paper};padding:16px 16px 6px;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule};font-family:${SANS};color:${C.ink};">${sections}</td></tr>`

  // Always a way to the subscriber's page (their country's, when it has one), not only when the list was cut.
  const seeAll = `See all grants${what ? ` for ${what}` : ''} on naturefunding.org`
  const more = `<p style="margin:0;">${total > items.length ? `And ${total - items.length} more. ` : ''}${link(esc(seeAll))}.</p>`
  const body =
    row(`<h1 style="margin:0;font-family:${SERIF};font-size:22px;line-height:1.3;font-weight:400;">${introHtml}</h1>`, { top: 24, bottom: 18 }) +
    band +
    row(`${more}<p style="margin:16px 0 0;font-size:14px;color:${C.ink2};">Each listing is checked against the funder’s own page. ${esc(fineprint)}</p>`, { top: 18, bottom: 24 })
  const footer = `You get this because you signed up at naturefunding.org${what ? ` for ${esc(what)}` : ''}. At most one email a week, only when something is new.<br>
<a href="${esc(o.manageUrl)}" style="color:${C.ink2};">Change what you get</a> · <a href="${esc(o.unsubscribeUrl)}" style="color:${C.ink2};">Unsubscribe</a>`

  const textItems = shown
    .map(([s]) =>
      [
        ...(headed ? [sectionTitle[s].toUpperCase()] : []),
        ...items
          .filter((i) => i.section === s)
          .map((i) => {
            const x = itemParts(i, o.site, o.prefs, o.currency)
            const amount = x.amount ? `${x.amount.text}${x.amount.original ? ` (${x.amount.original})` : ''}` : 'Amount not stated'
            const status = x.status ? `${x.status}${x.callLabel ? ` · ${x.callLabel}` : ''}` : null
            return [`- ${x.name}${x.funder ? ` · ${x.funder}` : ''}`, `  ${amount}`, x.place && `  ${x.place}`, x.types.length && `  ${x.types.map((t) => t.label).join(' · ')}`, status && `  ${status}`, `  ${x.page}`].filter(Boolean).join('\n')
          }),
      ].join('\n\n'),
    )
    .join('\n\n')
  const text = `${intro}.\n\n${textItems}\n\n${total > items.length ? `And ${total - items.length} more. ` : ''}${seeAll}: ${listUrl}\n\n${fineprint}\n\n--\nAt most one email a week, only when something is new.\nChange what you get: ${o.manageUrl}\nUnsubscribe: ${o.unsubscribeUrl}\n\n${TAGLINE}\n${POSTAL_ADDRESS}\n`
  return { subject, html: frame(o.site, intro, body, footer), text }
}
