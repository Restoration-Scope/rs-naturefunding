// The social cards (src/lib/og-card.tsx, src/lib/og-fonts.ts): fonts cover every character, the facts stay true,
// and a font that can't be fetched never stops the build.
import { afterEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { callGroups, programmes } from '../src/lib/data'
import { cardContent, cardText, cardVersion, renderCard } from '../src/lib/og-card'
import { missingChars } from '../src/lib/og-fonts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test('every card character has a stored font (else: bun scripts/images/og-fonts.ts)', () => {
  expect(missingChars(programmes.map(cardText).join(''))).toEqual([])
})

test('no single date on a card when calls differ by country', () => {
  const split = programmes.filter((p) => callGroups(p).length > 0)
  expect(split.length).toBeGreaterThan(0)
  for (const p of split) {
    const dates = cardContent(p).facts.filter((f) => f.label === 'Opens' || (f.label === 'Deadline' && f.value !== 'Rolling'))
    expect(dates, p.id).toEqual([])
  }
})

test('a character no font has, with Google Fonts unreachable, still draws the card and is not cached', async () => {
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
  const p = { ...programmes[0]!, id: 'og-test-unfetchable', name: `${programmes[0]!.name} 한국어 ☃` }
  const jpeg = await renderCard(p)
  expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
  expect(existsSync(join(process.cwd(), 'node_modules/.cache/og-cards', `${p.id}-${cardVersion(p)}.jpg`))).toBe(false)
}, 20_000)
