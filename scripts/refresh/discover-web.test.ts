import { describe, expect, test } from 'bun:test'
import { bareUrl, isNotFunder, isShared, newLeads, siteOf, type Hit } from './discover-web'

describe('siteOf keeps the registrable part of a host', () => {
  test('subdomains and www fold into the site', () => {
    expect(siteOf('fr.cepf.net')).toBe('cepf.net')
    expect(siteOf('www.asiacf.org')).toBe('asiacf.org')
    expect(siteOf('cdfgrants.smapply.io')).toBe('smapply.io')
  })
  test('country second-level domains keep three labels', () => {
    expect(siteOf('www.aucklandcouncil.govt.nz')).toBe('aucklandcouncil.govt.nz')
    expect(siteOf('www.south-staffs-water.co.uk')).toBe('south-staffs-water.co.uk')
    expect(siteOf('restaura-amazonia.fbds.org.br')).toBe('fbds.org.br')
    expect(siteOf('www.gov.br')).toBe('gov.br')
  })
})

describe('shared sites and directories', () => {
  test('government and platform hosts are shared', () => {
    expect(isShared('find-government-grants.service.gov.uk')).toBe(true)
    expect(isShared('www.canada.ca')).toBe(true)
    expect(isShared('bahamasprotectedareasfund.submittable.com')).toBe(true)
    expect(isShared('www.nsw.gov.au')).toBe(true)
    expect(isShared('asiacf.org')).toBe(false)
  })
  test('directories and their subdomains are never funders', () => {
    expect(isNotFunder('www.fundsforngos.org')).toBe(true)
    expect(isNotFunder('www2.fundsforngos.org')).toBe(true)
    expect(isNotFunder('afundsforngos.org')).toBe(false)
  })
  test('bareUrl drops scheme, www, tracking parameters, hash and trailing slash', () => {
    expect(bareUrl('https://www.Canada.ca/en/funding/?utm_source=x&fbclid=y#top')).toBe('canada.ca/en/funding')
  })
  test('bareUrl keeps parameters that pick the page', () => {
    expect(bareUrl('https://procurement-notices.undp.org/view_notice.cfm?notice_id=98948')).not.toBe(bareUrl('https://procurement-notices.undp.org/view_notice.cfm?notice_id=99999'))
  })
  test('US state agencies on .gov and .us are separate funders', () => {
    expect(isShared('wcb.ca.gov')).toBe(true)
    expect(isShared('www.dnr.state.mn.us')).toBe(true)
  })
})

describe('newLeads', () => {
  const hit = (url: string, title = 'Call'): Hit => ({ url, title })
  const data = ['https://www.cepf.net/grants', 'https://www.canada.ca/en/environment-climate-change/services/environmental-funding/programs/habitat-stewardship.html']

  test('one lead per site, counting the searches that found it', () => {
    const leads = newLeads([
      { hit: hit('https://www.asiacf.org/30x30fund/'), search: 0 },
      { hit: hit('https://asiacf.org/apply'), search: 0 },
      { hit: hit('https://asiacf.org/30x30fund'), search: 3 },
      { hit: hit('https://pngbcf.org/grants'), search: 1 },
    ], {}, data)
    expect(leads.map((l) => [l.key, l.searches])).toEqual([['web:asiacf.org', 2], ['web:pngbcf.org', 1]])
  })

  test('sites the data cites, raised leads and directories are skipped', () => {
    const leads = newLeads([
      { hit: hit('https://fr.cepf.net/resources/calls-for-proposals/wallacea'), search: 0 },
      { hit: hit('https://pngbcf.org/grants'), search: 0 },
      { hit: hit('https://www.fundsforngos.org/x'), search: 0 },
      { hit: hit('not a url'), search: 0 },
    ], { 'web:pngbcf.org': { title: 'PNG', url: 'https://pngbcf.org', deadline: null, first_seen: '2026-11-02', issue: null } }, data)
    expect(leads).toEqual([])
  })

  test('on a shared site the page is the lead, and only a cited page is skipped', () => {
    const leads = newLeads([
      { hit: hit('https://www.canada.ca/en/environment-climate-change/services/environmental-funding/programs/habitat-stewardship.html'), search: 0 },
      { hit: hit('https://www.canada.ca/en/environment-climate-change/services/environmental-funding/programs/indigenous-partnerships-species-risk.html'), search: 0 },
    ], {}, data)
    expect(leads.map((l) => l.key)).toEqual(['web:canada.ca/en/environment-climate-change/services/environmental-funding/programs/indigenous-partnerships-species-risk.html'])
  })

  test('a call the daily APIs raised is not raised again', () => {
    const url = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/HORIZON-CL6-2027-01-BIODIV-01'
    const known = { 'eu:HORIZON-CL6-2027-01-BIODIV-01': { title: 'Biodiv', url, deadline: '2027-09-22', first_seen: '2026-11-02', issue: null } }
    expect(newLeads([{ hit: hit(url), search: 0 }], known, data)).toEqual([])
  })
})
