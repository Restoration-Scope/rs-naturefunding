export const SITE_URL = 'https://naturefunding.org'
export const SITE_NAME = 'naturefunding.org'
export const REPO_URL = 'https://github.com/Restoration-Scope/rs-naturefunding'

const utm = (campaign: string) => `utm_source=naturefunding&utm_medium=referral&utm_campaign=${campaign}`

export const RS_URL = `https://restorationscope.com/?${utm('footer')}`
/** Restoration Scope has no funder-reporting guides yet; this is its donor-reporting page. */
export const RS_REPORTING_URL = `https://restorationscope.com/solutions/funders?${utm('programme-reporting')}`

export const absolute = (path: string) => new URL(path, SITE_URL).toString()

function issueUrl(title: string, body: string, labels: string) {
  const q = new URLSearchParams({ title, body, labels })
  return `${REPO_URL}/issues/new?${q}`
}

export const reportProblemUrl = (name: string, id: string) =>
  issueUrl(
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
    'listing-problem',
  )

export const funderCorrectionUrl = (name: string, id: string) =>
  issueUrl(
    `Funder correction: ${name}`,
    [
      `Listing: ${absolute(`/p/${id}/`)}`,
      '',
      'Your name, role and organisation:',
      '',
      'What should change, and the page on your website that says so:',
      '',
      'We check every change against your own website before it goes live. We never charge for a listing.',
      '',
    ].join('\n'),
    'funder-correction',
  )

export const generalIssueUrl = `${REPO_URL}/issues/new`
