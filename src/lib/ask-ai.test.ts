import { describe, expect, test } from 'bun:test'
import { askPrompt, assistantUrls, countryIn } from './ask-ai'
import { countriesByRegion } from './geo'
import { pageKey } from './page-paths'

const places = countriesByRegion.flatMap((r) => r.countries)
const pages = { [pageKey('KE', '')]: '/countries/kenya/', [pageKey('r:africa', '')]: '/regions/africa/' }
const name = (t: string) => countryIn(t, places)?.name ?? null

describe('the country a project line names', () => {
  test('one country, whole words only', () => {
    expect(name('mangroves in Kenya, $50,000')).toBe('Kenya')
    expect(name('peatlands in NIGERIA')).toBe('Nigeria')
    expect(name('forests of Papua New Guinea')).toBe('Papua New Guinea')
    expect(name('a Kenyan group')).toBeNull()
  })
  test('none or several: no pick', () => {
    expect(name('mangroves')).toBeNull()
    expect(name('Kenya and Brazil')).toBeNull()
  })
})

describe('the prompt', () => {
  test('starts on the place list: the country named, then the Where, then the index', () => {
    expect(askPrompt('mangroves in Kenya', '', places, pages)).toContain('https://naturefunding.org/countries/kenya.md')
    expect(askPrompt('mangroves', 'KE', places, pages)).toContain('mangroves (in Kenya)')
    expect(askPrompt('mangroves in Kenya', 'r:africa', places, pages)).toContain('/countries/kenya.md')
    expect(askPrompt('mangroves', 'r:africa', places, pages)).toContain('/regions/africa.md')
    expect(askPrompt('mangroves', '', places, pages)).toContain('1. Open https://naturefunding.org/countries.md')
  })
  test('the longest text still fits an address, whole', () => {
    const text = 'é & # '.repeat(200)
    for (const make of Object.values(assistantUrls)) {
      const url = make(askPrompt(text, 'KE', places, pages))
      expect(url.length).toBeLessThan(8000)
      expect(new URL(url).searchParams.get('q')).toContain(text.trim())
    }
  })
})
