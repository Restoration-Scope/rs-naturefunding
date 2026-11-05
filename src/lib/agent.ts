// What agents and answer engines read: llms.txt, llms-full.txt and the Markdown twin of each page. Built from
// the same data and labels as the HTML. Each fact line names its programme and carries its quote, source and
// checked date, so a line still holds up when an answer quotes it alone.
import type { Call, Evidence, Programme } from '../data/schema'
import { AGING_DAYS, HIDDEN_DAYS, buildDate, listingFor, programmeById, programmes, sortListings, stats, type Listing } from './data'
import { amountText, effortText, geographyFull, geographyText, joinAnd, longDate } from './format'
import { accessHelp, accessLabels, applicantLabels, approachLabels } from './labels'
import { RS_URL, SITE_NAME, absolute, funderCorrectionUrl, reportProblemUrl } from './site'
import { countryName } from './geo'
import { LLMS_FULL_PAGES, twinPath } from './twins'
import { evidenceOf } from '../data/load'
import type { FinderPage } from './finder-pages'

/** Element ids on a programme page, one per fact, so an answer can link the fact it cites. They match data.json field names. */
export const factIds = {
  access: 'access',
  amount: 'amount',
  geography: 'geography',
  applicant_types: 'applicant_types',
  window: 'window',
  co_finance_required: 'co_finance_required',
  consortium_required: 'consortium_required',
  administered_by: 'administered_by',
  approaches: 'approaches',
  reporting: 'reporting',
  effort: 'effort',
} as const
export const callId = (c: Pick<Call, 'id'>) => `call-${c.id}`
export const callFactId = (c: Pick<Call, 'id'>, field: 'status' | 'opens' | 'deadline' | 'recurring' | 'countries') => `call-${c.id}-${field}`

const listingUrl = (p: Programme) => absolute(`/p/${p.id}/`)
const NOT_FOUND = 'Not found on the pages we read'
/** The amount with the qualifier from the same quote, so a line quoted alone keeps its condition. */
const amountWithNote = (p: Programme) => {
  const a = amountText(p.amount)
  return a && p.amount?.note ? `${a} (${p.amount.note})` : a
}

const funderLine = (p: Programme) =>
  `From ${p.funder.name}${p.administered_by ? `, run by ${p.administered_by.name}` : ''}`

const deadlineWhen = (d: NonNullable<Call['deadline']>) =>
  `${longDate(d.date)}${d.time ? `, ${d.time}${d.timezone ? ` (${d.timezone})` : ''}` : ''}`

const openChildren = (p: Programme) =>
  programmes
    .filter((c) => c.parent === p.id)
    .map((c) => listingFor(c))
    .filter((l) => l.state === 'open' || l.state === 'rolling')

/** Where the programme stands, in one sentence that works without the page around it. */
export function statusText(l: Listing): string {
  const { p, state, call } = l
  if (p.access === 'invitation_only') return 'Invitation only: the funder picks its grantees and does not take unsolicited proposals.'
  if (p.access === 'intermediary') {
    const open = openChildren(p)
    return `Apply through a partner programme, not the funder.${open.length ? ` ${open.length === 1 ? 'One partner programme is' : `${open.length} partner programmes are`} open now.` : ''}`
  }
  const note = call?.note && (state === 'open' || state === 'upcoming') ? ` ${call.note}.` : ''
  // With several calls, say which one sets the status: the others may cover other places or dates.
  const which = call && p.calls.length > 1 ? ` (${call.label})` : ''
  const others = p.calls.filter((c) => c !== call && c.status === 'open' && !(c.deadline && c.deadline.date < buildDate)).length
  const more = state === 'open' && others ? ` ${others === 1 ? 'One more call is' : `${others} more calls are`} open; see the listing.` : ''
  switch (state) {
    case 'open':
      if (call?.deadline) return `Open${which}: apply by ${deadlineWhen(call.deadline)}. The funder gives the deadline as “${call.deadline.text}”.${note}${more}`
      if (call?.recurring) return `Open${which}, with dates each year: ${call.recurring}. The page gives no year, so check which date comes next.${note}${more}`
      return `Open${which}. The funder’s page gives no dated deadline, so check the window is still open before applying.${note}${more}`
    case 'rolling':
      return 'Open: rolling, apply any time, no deadline.'
    case 'upcoming': {
      const when = call?.opens ? `opens ${longDate(call.opens)}` : call?.expected ? `expected to open ${call.expected}` : 'opening date not announced yet'
      return `Upcoming${which}: ${when}.${call?.deadline ? ` Closes ${deadlineWhen(call.deadline)}.` : ''}${note}`
    }
    case 'closed':
      return `No call open now. The last call we found${call?.deadline ? ` closed on ${longDate(call.deadline.date)}` : ' has closed'}; check the funder’s page for the next round.`
    default:
      return call?.recurring
        ? `Windows each year: ${call.recurring}. The funder’s page doesn’t say whether one is open now.`
        : 'No open or announced call found on the funder’s page.'
  }
}

const quoteLines = (subject: string, value: string, e: Evidence | Evidence[] | undefined, anchor: string, p: Programme) => {
  const lines = [`**${subject}:** ${value}`]
  for (const q of [e ?? []].flat()) {
    lines.push('', `> “${q.quote}”`, '', `Source: ${q.source_url}, checked ${longDate(q.checked_at)}.`)
  }
  lines.push(`Cite this fact: ${listingUrl(p)}#${anchor}`)
  return lines.join('\n')
}

/** The Markdown twin of /p/{id}/. */
export function programmeMarkdown(p: Programme): string {
  const l = listingFor(p)
  const children = programmes.filter((c) => c.parent === p.id)
  const parent = p.parent ? programmeById.get(p.parent) : undefined
  const byPartner = children.length > 0 ? 'Set by each partner programme' : NOT_FOUND
  const amount = amountWithNote(p)
  const who = p.applicant_types ? joinAnd(p.applicant_types.map((a) => applicantLabels[a])) : null
  const rounds = p.window === 'rolling' ? 'Rolling: apply any time' : p.window === 'fixed' ? 'Fixed rounds with deadlines' : null
  const coFunding = p.co_finance_required === null ? null : p.co_finance_required ? 'Yes' : 'No'
  const consortium = p.consortium_required === undefined ? null : p.consortium_required ? 'Yes' : 'No'
  const n = p.name
  const out: string[] = []

  out.push(`# ${n}`, '', `${funderLine(p)}. Listed on ${SITE_NAME}, a free directory of nature restoration and conservation funding where every fact is read from the funder’s own page or the organisation that runs the programme for it.`)
  if (l.ageDays > HIDDEN_DAYS) {
    out.push('', `**Out of date:** this listing has not been checked for over ${HIDDEN_DAYS} days and is hidden from the finder. Treat every fact as out of date until the funder’s page confirms it.`)
  } else if (l.aging) {
    out.push('', `**Due a recheck:** last checked over ${AGING_DAYS} days ago. Confirm on the funder’s page before relying on it.`)
  }
  if (p.kind === 'partnership') out.push('', '**Paid partnership, not a grant:** the funder pays for work under a contract.')
  out.push(
    '',
    // A closed call may have been closed by its deadline passing, after its last check, so it is dated by the build.
    l.state === 'closed'
      ? `- Status, as of ${longDate(buildDate)}: ${statusText(l)}`
      : `- Status, from the check on ${longDate(l.call?.evidence.status?.checked_at ?? p.checked_at)}: ${statusText(l)}`,
    `- How to apply: ${accessLabels[p.access]}`,
    `- Amount: ${amount ?? (children.length ? byPartner : NOT_FOUND)}`,
    `- Who can apply: ${who ?? byPartner}`,
    `- Where: ${geographyFull(p.geography) ?? NOT_FOUND}`,
    `- Rounds: ${rounds ?? byPartner}`,
    `- Co-funding required: ${coFunding ?? byPartner}`,
    ...(consortium ? [`- Consortium required: ${consortium}`] : []),
    ...(p.administered_by ? [`- Run by: ${p.administered_by.name} (${p.administered_by.url})`] : []),
    `- Restoration approach (our classification): ${joinAnd(p.approaches.map((a) => approachLabels[a]))}`,
    `- Last checked: ${longDate(p.checked_at)}. Every quote below was read on or after this day.`,
    '',
    'How to apply, who can apply and where are our categories, from the funder’s words; the quotes are below.',
    `- Listing: ${listingUrl(p)}`,
    `- Funder’s programme page: ${p.url}`,
    '',
    `Summary in ${SITE_NAME}’s own words: ${p.summary}`,
  )

  const open = openChildren(p)
  if (children.length) {
    out.push('', '## Partner programmes', '', `You apply to one of these, each with its own calls and deadlines.${open.length ? ` ${open.length} open now.` : ''}`, '')
    for (const c of children.map((c) => listingFor(c)).sort(sortListings)) {
      out.push(`- [${c.p.name}](${listingUrl(c.p)}): ${statusText(c)}`)
    }
  }

  out.push('', '## The facts, in the funder’s words', '')
  if (children.length) out.push(`These cover ${n} as a whole. Each partner programme sets its own amounts and deadlines.`, '')
  const facts = [
    quoteLines(`${n}, how to apply`, `${accessLabels[p.access]}. ${accessHelp[p.access]}`, p.evidence.access, factIds.access, p),
    quoteLines(`${n}, amount`, amount ? `${amount}${p.amount?.note ? `. ${p.amount.note}.` : ''}` : byPartner, p.evidence.amount, factIds.amount, p),
    quoteLines(`${n}, where`, geographyFull(p.geography) ?? NOT_FOUND, p.evidence.geography, factIds.geography, p),
    quoteLines(`${n}, who can apply`, who ?? byPartner, p.evidence.applicant_types, factIds.applicant_types, p),
    quoteLines(`${n}, rounds`, rounds ?? byPartner, p.evidence.window, factIds.window, p),
    quoteLines(`${n}, co-funding required`, coFunding ?? byPartner, p.evidence.co_finance_required, factIds.co_finance_required, p),
    ...(consortium ? [quoteLines(`${n}, consortium required`, consortium, p.evidence.consortium_required, factIds.consortium_required, p)] : []),
    ...(p.administered_by ? [quoteLines(`${n}, run by`, p.administered_by.name, p.evidence.administered_by, factIds.administered_by, p)] : []),
    ...(p.access === 'direct' && p.effort ? [quoteLines(`${n}, steps to apply`, effortText(p.effort)!, p.evidence.effort, factIds.effort, p)] : []),
  ]
  out.push(facts.join('\n\n'))

  if (p.calls.length) {
    out.push('', p.calls.length === 1 ? '## The call' : `## Calls (${p.calls.length})`)
    const ordered = l.call ? [l.call, ...p.calls.filter((c) => c !== l.call)] : p.calls
    for (const c of ordered) {
      const s = `${n}, ${c.label}`
      const statusWords: Record<Call['status'], string> = {
        open: 'Open', upcoming: 'Upcoming', closed: 'Closed', suspended: 'Suspended',
        unknown: c.recurring ? 'Windows each year; the page doesn’t say if one is open now' : 'Not clear from the page',
      }
      const parts = [
        quoteLines(`${s}, status`, statusWords[c.status], c.evidence.status, callFactId(c, 'status'), p),
        ...(c.countries ? [quoteLines(`${s}, where`, joinAnd(c.countries.map(countryName)), c.evidence.countries, callFactId(c, 'countries'), p)] : []),
        ...(c.opens || c.expected || c.evidence.opens
          ? [quoteLines(`${s}, opens`, c.opens ? longDate(c.opens) : c.expected ? `Expected ${c.expected}` : NOT_FOUND, c.evidence.opens ?? (c.expected ? c.evidence.status : undefined), callFactId(c, 'opens'), p)]
          : []),
        ...(c.deadline || !c.recurring
          ? [quoteLines(`${s}, deadline`, c.deadline ? `${deadlineWhen(c.deadline)} (the funder writes “${c.deadline.text}”)` : p.window === 'rolling' ? 'None: apply any time' : 'Not found on the call page', c.evidence.deadline, callFactId(c, 'deadline'), p)]
          : []),
        ...(c.recurring ? [quoteLines(`${s}, dates each year`, c.recurring, c.evidence.recurring, callFactId(c, 'recurring'), p)] : []),
      ]
      out.push('', `### ${c.label}`, '', `Call page: ${c.url}`, '', parts.join('\n\n'))
      if (c.note) out.push('', `Condition: ${c.note}.`)
    }
  }

  out.push('', '## What the funder asks grantees to report', '', quoteLines(`${n}, reporting`, p.reporting ?? NOT_FOUND, p.evidence.reporting, factIds.reporting, p))
  if (parent) out.push('', '## Part of a larger programme', '', `[${parent.name}](${listingUrl(parent)}), from ${parent.funder.name}.`)
  out.push(
    '',
    '## How to cite',
    '',
    `${SITE_NAME}, “${n}”, checked ${longDate(p.checked_at)}, ${listingUrl(p)}. Data CC BY 4.0. Quotes are the funder’s words; cite the funder’s page for them.`,
    '',
    '## Something wrong?',
    '',
    `Report a problem: ${reportProblemUrl(p.name, p.id)}`,
    `Funders can correct their listing: ${funderCorrectionUrl(p.name, p.id)}`,
    '',
  )
  return out.join('\n')
}

const groups: { title: string; test: (l: Listing) => boolean }[] = [
  { title: 'Open now, soonest deadline first', test: (l) => l.state === 'open' },
  { title: 'Open any time (rolling)', test: (l) => l.state === 'rolling' },
  { title: 'Upcoming', test: (l) => l.state === 'upcoming' },
  { title: 'Through a partner or by invitation only', test: (l) => l.state === 'none' && (l.p.access === 'intermediary' || l.p.access === 'invitation_only') },
  { title: 'No call found', test: (l) => l.state === 'none' && l.p.access !== 'intermediary' && l.p.access !== 'invitation_only' },
  { title: 'Closed, most recently closed first', test: (l) => l.state === 'closed' },
]

const sorted = (ls: Listing[]) => [...ls].sort(sortListings)

/** One line per listing, readable alone. `link` picks the page or its twin. */
const listingLine = (l: Listing, link: (p: Programme) => string) => {
  const { p } = l
  const bits = [
    statusText(l),
    amountWithNote(p) && `Amount: ${amountWithNote(p)}.`,
    geographyText(p.geography) && `Where: ${geographyText(p.geography)}.`,
    p.applicant_types && `Who: ${joinAnd(p.applicant_types.map((a) => applicantLabels[a]))}.`,
    `Checked ${longDate(p.checked_at)}.`,
  ].filter(Boolean)
  return `- [${p.name}](${link(p)}), ${p.funder.name}: ${bits.join(' ')}`
}

const intro = (listings: Listing[]) =>
  [
    `${SITE_NAME} is a free, neutral directory of grants and funding for nature restoration and conservation. Every deadline, amount and eligibility rule is read from the funder’s own page, or the page of the organisation that runs the programme for it, and shown with the exact words and the date it was checked. Deadlines are never guessed: “not found” means the pages we read don’t say. Built and paid for openly by Restoration Scope (${RS_URL.split('?')[0]}); funders can’t pay to be listed or ranked.`,
    '',
    `${listings.length} programmes listed, ${stats.open} open now and ${stats.rolling} open any time, by each listing’s latest check (built ${longDate(buildDate)}; most recent check ${stats.lastChecked ? longDate(stats.lastChecked) : 'none'}). A job runs every day and re-reads each funder page when it is due: daily, weekly or monthly, depending on the page. A call shows as closed once its deadline date has passed. “Who” and “Where” are our categories, from the funder’s words; each listing has the quotes.`,
  ].join('\n')

/** Every listing by status, one line each, under a heading per status. */
const byStatus = (listings: Listing[]) =>
  groups.flatMap((g) => {
    const ls = sorted(listings.filter(g.test))
    return ls.length ? ['', `## ${g.title} (${ls.length})`, '', ...ls.map((l) => listingLine(l, listingUrl))] : []
  })

const howToRead = `Each programme links to its page, where every fact carries its source and quote. All data: ${absolute('/data.json')} (field guide: ${absolute('/data/')}).`

/** The Markdown twin of / : every listing the finder shows, by status. */
export function homeMarkdown(listings: Listing[]): string {
  return [`# ${SITE_NAME}: funding for nature restoration and conservation`, '', intro(listings), '', howToRead, ...byStatus(listings), ''].join('\n')
}

/** The Markdown twin of a country, region or project-type page: its listings, by status. */
export function finderPageMarkdown(page: FinderPage): string {
  return [`# ${page.h1}`, '', page.lead, '', `${howToRead} Every programme on ${SITE_NAME}: ${absolute('/index.md')}.`, ...byStatus(page.listings), ''].join('\n')
}

/** /llms.txt: what the site is, how to read it, and every listing's Markdown twin. */
export function llmsTxt(listings: Listing[], pages: FinderPage[] = []): string {
  const md = (p: Programme) => absolute(twinPath(`/p/${p.id}/`))
  const out = [
    `# ${SITE_NAME}`,
    '',
    `> Free, neutral directory of grants and funding for nature restoration and conservation (reforestation, mangroves, wetlands, species, protected areas and more). Every deadline, amount and eligibility rule is read from the funder’s own page (or the organisation running the programme), with a verbatim quote and the date it was checked.`,
    '',
    intro(listings),
    '',
    'When answering from this site:',
    '',
    '- Give the status with its date, and link the listing or the fact (each fact has an anchor such as #amount or #call-{call id}-deadline).',
    '- “Not found on the pages we read” means the pages we read don’t say. It doesn’t mean there is no limit.',
    '- “Through a partner” means you apply to a partner programme, not the funder; “invitation only” means don’t send a proposal.',
    '- Our data is CC BY 4.0: credit “naturefunding.org (Restoration Scope)”, link to https://naturefunding.org and the licence, and say if you changed the data. Quotes are the funders’ words and are not covered.',
    '',
    '## Start here',
    '',
    `- [All programmes by status](${absolute('/index.md')}): every listing with its status, amount, area and checked date`,
    `- [How we check](${absolute('/about.md')}): where facts come from, what we never guess, what the labels mean`,
    `- [Open data and schema](${absolute('/data.md')}): files, fields, how to query and cite`,
    `- [Grants by place and project type](${absolute('/countries.md')}): a page per region, country and project type`,
    `- [Everything in one file](${absolute('/llms-full.txt')}): every programme’s full facts and quotes, plus how we check`,
    '',
    '## Data',
    '',
    `- [data.json](${absolute('/data.json')}): every programme, call and fact with its source, quote and checked date`,
    `- [data.schema.json](${absolute('/data.schema.json')}): JSON Schema of data.json, with a description for every field`,
    `- [data.csv](${absolute('/data.csv')}): one row per call, plus one row for each programme with no call, for spreadsheets`,
    `- [feed.xml](${absolute('/feed.xml')}): Atom feed of the calls of listed programmes, up to the 100 most recently updated; a call that opens, closes or changes its deadline date gets a new entry`,
    `- [health.json](${absolute('/health.json')}): the latest run of the daily checking job: how many sources were due, unchanged, changed or could not be read`,
  ]
  if (pages.length) {
    out.push('', '## By place and project type', '')
    for (const pg of pages) out.push(`- [${pg.h1}](${absolute(twinPath(pg.path))}): ${pg.listings.length} programmes`)
  }
  for (const g of groups) {
    const ls = sorted(listings.filter(g.test))
    if (!ls.length) continue
    out.push('', `## ${g.title}`, '', ...ls.map((l) => `- [${l.p.name}](${md(l.p)}): ${l.p.funder.name}. ${statusText(l)}`))
  }
  out.push('')
  return out.join('\n')
}

/** /llms-full.txt: the intro and every listing's full twin. The about and data twins are added after the build. */
export function llmsFullTxt(listings: Listing[]): string {
  return [
    `# ${SITE_NAME}: every listing in full`,
    '',
    intro(listings),
    '',
    `Index: ${absolute('/llms.txt')}. Data: ${absolute('/data.json')}.`,
    '',
    LLMS_FULL_PAGES,
    '',
    ...sorted(listings).map((l) => programmeMarkdown(l.p).replace(/^(#+) /gm, '#$1 ')),
  ].join('\n')
}

/**
 * schema.org for a programme page: the WebPage (when it was last checked, and the funder pages it rests on) and,
 * for a grant, the MonetaryGrant with its amount, area and how to apply. A paid partnership is a contract for
 * work, not a grant, so it gets no MonetaryGrant.
 */
export function grantJsonLd(l: Listing): object[] {
  const { p, state, call } = l
  const url = listingUrl(p)
  const apply =
    p.access === 'direct' && call && (state === 'open' || state === 'rolling' || state === 'upcoming')
      ? {
          '@type': 'ApplyAction',
          target: call.url,
          ...(state === 'upcoming' && call.opens && { startTime: call.opens }),
          ...(state === 'open' && call.deadline && { endTime: call.deadline.date }),
        }
      : null
  const grant =
    p.kind === 'partnership'
      ? null
      : {
          '@type': 'MonetaryGrant',
          '@id': `${url}#grant`,
          identifier: p.id,
          name: p.name,
          description: p.summary,
          url: p.url,
          funder: { '@type': 'Organization', name: p.funder.name, url: p.funder.url },
          ...(p.amount && {
            amount: {
              '@type': 'MonetaryAmount',
              currency: p.amount.currency,
              ...(p.amount.min !== undefined && { minValue: p.amount.min }),
              ...(p.amount.max !== undefined && { maxValue: p.amount.max }),
              description: amountWithNote(p),
            },
          }),
          ...(p.geography && { areaServed: geographyFull(p.geography) }),
          ...(p.applicant_types && {
            audience: { '@type': 'Audience', audienceType: joinAnd(p.applicant_types.map((a) => applicantLabels[a])) },
          }),
          ...(apply && { potentialAction: apply }),
        }
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': url,
      url,
      name: `${p.name}, ${p.funder.name}`,
      dateModified: p.checked_at,
      lastReviewed: p.checked_at,
      isBasedOn: [...new Set(evidenceOf(p).map((e) => e.source_url))],
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: absolute('/') },
      ...(grant && { mainEntity: grant }),
    },
  ]
}

/** schema.org ItemList of the programmes the finder shows, in its order: URLs only, to keep the home page light. */
export function homeItemListLd(listings: Listing[], name = 'Funding for nature restoration and conservation'): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: listings.length,
    itemListElement: listings.map((l, i) => ({ '@type': 'ListItem', position: i + 1, url: listingUrl(l.p) })),
  }
}
