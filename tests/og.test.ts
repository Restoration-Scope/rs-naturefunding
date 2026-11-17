// The social cards' fonts draw every character the cards use (src/lib/og-card.tsx, src/lib/og-fonts.ts).
import { expect, test } from 'bun:test'
import { programmes } from '../src/lib/data'
import { cardText } from '../src/lib/og-card'
import { missingChars } from '../src/lib/og-fonts'

test('every card character has a stored font (else: bun scripts/images/og-fonts.ts)', () => {
  expect(missingChars(programmes.map(cardText).join(''))).toEqual([])
})
