/**
 * Fonts for the social cards (src/lib/og-card.tsx). Inter and Geist Serif cover Latin; names in Japanese or
 * Chinese draw from Noto subsets holding only the characters the cards use, cut by Google Fonts
 * (bun scripts/images/og-fonts.ts writes them, src/assets/og-fonts/cjk-*.ttf).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { create, type Font as FontFile } from 'fontkitten'

export const OG_FONT_DIR = join(process.cwd(), 'src/assets/og-fonts')

/** Latin fonts first; each CJK subset after, in the order the script made them. Satori keeps one font per name and
 * weight, so each file has its own name; a character the named font lacks comes from any other. */
export const ogFontFiles = (): { file: string; name: string; weight: 400 | 600 }[] => [
  { file: 'geist-serif-regular.woff', name: 'Serif', weight: 400 },
  { file: 'inter-latin-400-normal.woff', name: 'Inter', weight: 400 },
  { file: 'inter-latin-ext-400-normal.woff', name: 'Inter Ext', weight: 400 },
  { file: 'inter-latin-600-normal.woff', name: 'Inter', weight: 600 },
  { file: 'inter-latin-ext-600-normal.woff', name: 'Inter Ext', weight: 600 },
  ...readdirSync(OG_FONT_DIR)
    .filter((f) => /^cjk-.*\.ttf$/.test(f))
    .sort()
    .map((file) => ({ file, name: file, weight: 400 as const })),
]

/** The families tried, in order, for characters the Latin fonts lack. */
export const CJK_FAMILIES = ['Noto Sans JP', 'Noto Sans TC', 'Noto Sans SC', 'Noto Sans KR']

const SPACE = /\s/u

/** The characters in `text` that none of the given fonts draws (whitespace aside). */
export function missingChars(text: string, files = ogFontFiles().map((f) => f.file)): string[] {
  const parsed = files.map((f) => create(readFileSync(join(OG_FONT_DIR, f))) as FontFile)
  return [...new Set(text)].filter((ch) => !SPACE.test(ch) && !parsed.some((f) => f.hasGlyphForCodePoint(ch.codePointAt(0)!)))
}

/** A TTF with just these characters from a Google Fonts family, or null when it has none of them. */
export async function googleSubset(family: string, chars: string): Promise<Buffer | null> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400&text=${encodeURIComponent(chars)}`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (!css.ok) throw new Error(`Google Fonts ${family}: HTTP ${css.status}`)
  const url = (await css.text()).match(/url\((https:[^)]+)\)\s*format\('truetype'\)/)?.[1]
  if (!url) return null
  const ttf = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  // Asked for characters the family lacks, Google Fonts answers with a file URL that fails.
  if (!ttf.ok) return null
  return Buffer.from(await ttf.arrayBuffer())
}
