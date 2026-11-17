// Cuts the CJK fonts for the social cards: every character a programme card draws that Inter and Geist Serif
// lack, from Noto Sans JP first, then TC, SC and KR for what is left. Writes src/assets/og-fonts/cjk-*.ttf.
// Run after adding listings with Japanese, Chinese or Korean names: bun scripts/images/og-fonts.ts
// (tests/og.test.ts says when it is needed).
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { programmes } from '../../src/lib/data'
import { cardText } from '../../src/lib/og-card'
import { CJK_FAMILIES, OG_FONT_DIR, googleSubset, missingChars, ogFontFiles } from '../../src/lib/og-fonts'

const latin = ogFontFiles()
  .map((f) => f.file)
  .filter((f) => !f.startsWith('cjk-'))
let left = missingChars(programmes.map(cardText).join(''), latin)
console.log(`${left.length} characters beyond the Latin fonts`)

for (const f of readdirSync(OG_FONT_DIR).filter((x) => x.startsWith('cjk-'))) rmSync(join(OG_FONT_DIR, f))
const written: string[] = []
for (const [i, family] of CJK_FAMILIES.entries()) {
  if (!left.length) break
  const data = await googleSubset(family, left.join(''))
  if (!data) continue
  const file = `cjk-${i}-${family.toLowerCase().replaceAll(' ', '-')}.ttf`
  writeFileSync(join(OG_FONT_DIR, file), data)
  written.push(file)
  left = missingChars(left.join(''), [...latin, ...written])
  console.log(`${file}: ${data.length} B, ${left.length} characters still missing`)
}
if (left.length) console.warn(`No font draws: ${left.join(' ')}`)
