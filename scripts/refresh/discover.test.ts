import { describe, expect, test } from 'bun:test'
import { isNbsEuTopic, isNbsUsOpportunity, newCandidates, plainText, quoteFrom, usDate, type Candidate } from './discover'

describe('EU topics are chosen by code', () => {
  test('nature and biodiversity codes pass whatever the text', () => {
    expect(isNbsEuTopic('HORIZON-NATURE-2027-02-05', '')).toBe(true)
    expect(isNbsEuTopic('HORIZON-CL6-2027-01-BIODIV-03', '')).toBe(true)
    expect(isNbsEuTopic('LIFE-2023-SAP-NAT-NATURE', '')).toBe(true)
    expect(isNbsEuTopic('LIFE-2023-TA-PP-NAT-SNAP', '')).toBe(true)
  })
  test('adaptation, communities and food-system codes need NbS in the text', () => {
    expect(isNbsEuTopic('LIFE-2026-SAP-CLIMA-CCA', 'Nature-based solutions for flood risk')).toBe(true)
    expect(isNbsEuTopic('LIFE-2026-SAP-CLIMA-CCA', 'Insurance products for heatwaves')).toBe(false)
    expect(isNbsEuTopic('HORIZON-CL6-2027-02-FARM2FORK-01', 'agroforestry systems')).toBe(true)
    expect(isNbsEuTopic('HORIZON-CL6-2027-02-FARM2FORK-01', 'food packaging')).toBe(false)
  })
  test('other programmes never pass, even with nature words', () => {
    expect(isNbsEuTopic('HORIZON-CL2-2027-HERITAGE-01', 'ecosystem restoration of heritage sites')).toBe(false)
    expect(isNbsEuTopic('CERV-2027-CITIZENS', 'restoration')).toBe(false)
  })
})

describe('US opportunities are chosen by title', () => {
  test('restoration, habitat, invasive and fish passage titles pass', () => {
    expect(isNbsUsOpportunity('DARRP Restoration Implementation Grants (2026)')).toBe(true)
    expect(isNbsUsOpportunity('F26AS00105 National Fish Passage Program')).toBe(true)
    expect(isNbsUsOpportunity('Aquatic Invasive Species Grants to Great Lakes Tribes')).toBe(true)
    expect(isNbsUsOpportunity('WaterSMART Cooperative Watershed Management Program')).toBe(true)
  })
  test('compensation, rescue, recreation and broad announcements do not', () => {
    expect(isNbsUsOpportunity('Endangered Species Conservation – Wolf Livestock Loss Compensation')).toBe(false)
    expect(isNbsUsOpportunity('Prescott Marine Mammal Rescue and Response')).toBe(false)
    expect(isNbsUsOpportunity('Outdoor Recreation Legacy Partnership Program')).toBe(false)
    expect(isNbsUsOpportunity('FY 2026 - 2028 Broad Agency Announcement (BAA), National Ocean Service')).toBe(false)
    expect(isNbsUsOpportunity('National Bycatch Reduction Engineering Program')).toBe(false)
  })
})

describe('text helpers', () => {
  test('plainText strips tags and decodes entities', () => {
    expect(plainText('<p>Wolf&nbsp;Livestock &ndash; <b>Loss</b> &amp; Prevention&#39;s</p>')).toBe("Wolf Livestock – Loss & Prevention's")
  })
  test('quoteFrom keeps whole sentences under the limit', () => {
    const text = `${'A'.repeat(120)}. ${'B'.repeat(120)}. ${'C'.repeat(120)}.`
    expect(quoteFrom(text)).toBe(`${'A'.repeat(120)}. ${'B'.repeat(120)}.`)
    expect(quoteFrom('Short text.')).toBe('Short text.')
  })
  test('usDate reads MM/DD/YYYY and nothing else', () => {
    expect(usDate('04/30/2027')).toBe('2027-04-30')
    expect(usDate('')).toBeNull()
    expect(usDate(undefined)).toBeNull()
  })
})

describe('newCandidates', () => {
  const c = (id: string, source: 'eu' | 'us' = 'eu'): Candidate => ({
    key: `${source}:${id}`, source, id, title: id, funder: 'x', url: `https://example.org/${id}`, deadline: '2027-01-14', status: 'open', quote: 'q', note: null,
  })
  test('drops calls already raised, already in data/, or found twice', () => {
    const known = { 'eu:HORIZON-NATURE-2027-01-01': { title: '', url: '', deadline: null, first_seen: '2026-11-02', issue: null } }
    const data = '{"url": "https://www.grants.gov/search-results-detail/1", "quote": "F26AS00105"}'
    const out = newCandidates([c('HORIZON-NATURE-2027-01-01'), c('F26AS00105', 'us'), c('HORIZON-NATURE-2027-01-02'), c('HORIZON-NATURE-2027-01-02')], known, data)
    expect(out.map((x) => x.key)).toEqual(['eu:HORIZON-NATURE-2027-01-02'])
  })
})
