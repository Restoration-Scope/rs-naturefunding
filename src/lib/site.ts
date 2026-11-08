export const SITE_URL = 'https://naturefunding.org'
export const SITE_NAME = 'naturefunding.org'

const utm = (campaign: string) => `utm_source=naturefunding&utm_medium=referral&utm_campaign=${campaign}`

export const RS_URL = `https://restorationscope.com/?${utm('footer')}`
/** Restoration Scope has no funder-reporting guides yet; this is its donor-reporting page. */
export const RS_REPORTING_URL = `https://restorationscope.com/solutions/funders?${utm('programme-reporting')}`
/** The footer's second line, for the operators who read this site. */
export const RS_FOOTER_REPORTING_URL = `https://restorationscope.com/solutions/funders?${utm('footer-reporting')}`

/** How every page names its builder: one line, the same words as the footer (rs-chief-of-staff surfaces ledger). */
export const RS_DESCRIPTOR = 'builds digital infrastructure for nature projects: field data, maps and reporting for project teams'

/** schema.org publisher/creator for every page. */
export const RS_ORG = {
  '@type': 'Organization',
  name: 'Restoration Scope',
  url: 'https://restorationscope.com',
  description: `Restoration Scope ${RS_DESCRIPTOR}.`,
  sameAs: ['https://www.linkedin.com/company/restoration-scope'],
}

export const absolute = (path: string) => new URL(path, SITE_URL).toString()

export const CONTACT_EMAIL = 'contact@naturefunding.org'

// A pre-filled email. Spaces stay %20 (URLSearchParams would write +, which mail apps show as is).
const mailUrl = (subject: string, body: string) =>
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

export const reportProblemUrl = (name: string, id: string) =>
  mailUrl(
    `Problem with ${name}`,
    [
      `Listing: ${absolute(`/p/${id}/`)}`,
      '',
      'What is wrong (deadline, amount, eligibility, link…)?',
      '',
      '',
      'Where did you see the correct information? A link to the funder’s own page helps most.',
      '',
    ].join('\n'),
  )

export const funderCorrectionUrl = (name: string, id: string) =>
  mailUrl(
    `Funder correction: ${name}`,
    [
      `Listing: ${absolute(`/p/${id}/`)}`,
      '',
      'Your name, role and organisation:',
      '',
      'What should change, and the page on your website that says so:',
      '',
      'We change a listing only after confirming it on your own website. Listings can’t be bought.',
      '',
    ].join('\n'),
  )

export const generalReportUrl = mailUrl(
  'naturefunding.org: a problem or a missing funder',
  ['What is wrong, or which funder is missing? A link to the funder’s own page helps most.', '', ''].join('\n'),
)

/** The weekly email Worker (digest/) is deployed, so built pages show the sign-up form. */
export const DIGEST_LIVE = true
