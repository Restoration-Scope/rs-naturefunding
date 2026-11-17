/**
 * The social card for one programme page (og:image, 1200×630 JPEG at /og/<id>.jpg, src/pages/og/[id].jpg.ts):
 * the home card's green and forest, with the programme's name, funder and the facts its page leads with.
 * Satori lays the text out as paths (src/lib/og-fonts.ts); sharp lays it over the forest.
 * The card states no Open or Closed: link previews are cached for weeks, so it gives dates, which stay true.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import satori, { type Font } from 'satori'
import sharp from 'sharp'
import type { Programme } from '../data/schema'
import { HIDDEN_DAYS, listingFor } from './data'
import { amountText, funderRepeatsName, geographyText, longDate, poolText } from './format'
import { accessLabels } from './labels'
import { markFor } from './marks'
import { CJK_FAMILIES, OG_FONT_DIR, googleSubset, ogFontFiles } from './og-fonts'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
const ART_LEFT = 830
const TEXT_WIDTH = 750

let fonts: Font[] | undefined
const loadFonts = () =>
  (fonts ??= ogFontFiles().map(({ file, name, weight }) => ({
    name,
    data: readFileSync(join(OG_FONT_DIR, file)),
    weight,
    style: 'normal' as const,
  })))

/**
 * Characters no stored font has (a new listing in another script): cut them from Google Fonts for this build,
 * and say so, so the stored subsets catch up (tests/og.test.ts fails until they do).
 */
async function fetchMissing(_lang: string, segment: string): Promise<Font[]> {
  console.warn(`og-card: no stored font draws "${segment}"; fetching it. Run bun scripts/images/og-fonts.ts`)
  for (const family of CJK_FAMILIES) {
    const data = await googleSubset(family, segment)
    if (data) return [400, 600].map((weight) => ({ name: `${family} (fetched)`, data, weight: weight as 400 | 600, style: 'normal' as const }))
  }
  // A missing glyph is left blank rather than stopping the deploy; tests/og.test.ts catches it before a commit.
  console.warn(`og-card: no font found for "${segment}"`)
  return []
}

/** Whether a programme page gets its own card. Hidden (stale) listings keep the site's card. */
export const hasOwnCard = (p: Programme) => listingFor(p).ageDays <= HIDDEN_DAYS

export type CardFact = { label: string; value: string }
export type CardContent = { title: string; funder: string | null; facts: CardFact[] }

/** What the card says: the page's name, funder line and leading facts, in the page's own words. */
export function cardContent(p: Programme): CardContent {
  const { state, call } = listingFor(p)
  // "Forest Action Facility (established by IUCN and KfW)" under "Forest Action Facility": only what the name doesn't say.
  const funder = funderRepeatsName(p)
    ? p.funder.name
        .slice(p.name.length)
        .trim()
        .replace(/^\((.*)\)$/, '$1')
        .replace(/^./, (ch) => ch.toUpperCase()) || null
    : p.funder.name
  const facts: CardFact[] = []
  const amount = amountText(p.amount)
  const pool = poolText(p.pool)
  if (amount) facts.push({ label: 'Per project', value: amount })
  else if (pool) facts.push({ label: 'Total budget', value: pool[0]!.toUpperCase() + pool.slice(1) })
  const where = geographyText(p.geography)
  if (where) facts.push({ label: 'Where', value: where })
  if (state === 'rolling') facts.push({ label: 'Deadline', value: 'Rolling' })
  else if (call?.status === 'upcoming' && call.opens) facts.push({ label: 'Opens', value: longDate(call.opens) })
  else if (call?.deadline) facts.push({ label: 'Deadline', value: longDate(call.deadline.date) })
  else if (p.access === 'intermediary' || p.access === 'invitation_only') facts.push({ label: 'To apply', value: accessLabels[p.access] })
  return { title: p.name, funder, facts }
}

/** Every character a programme's card draws, for the font coverage check. */
export const cardText = (p: Programme) => {
  const c = cardContent(p)
  return [c.title, c.funder ?? '', ...c.facts.flatMap((f) => [f.label, f.value]), 'naturefunding.org', 'From'].join('')
}

/** Changes whenever the card would, so link previews cached under the old URL refresh. */
export const cardVersion = (p: Programme) =>
  createHash('sha256').update(JSON.stringify([cardContent(p), markFor(p.funder)])).digest('hex').slice(0, 10)

export const cardPath = (p: Programme) => `/og/${p.id}.jpg?v=${cardVersion(p)}`

export const cardAlt = (p: Programme) => {
  const c = cardContent(p)
  return `${c.title}${c.funder ? `, from ${c.funder}` : ''}${c.facts.length ? `: ${c.facts.map((f) => `${f.label.toLowerCase()} ${f.value}`).join('; ')}` : ''}`
}

/** The title steps down as names get longer, so most fit in three lines. */
const titleSize = (t: string) => (t.length <= 36 ? 68 : t.length <= 64 ? 60 : t.length <= 100 ? 50 : 42)

const ink = '#f7f4ef'
const ink2 = '#beccc2'
const green = '#254b36'

async function markData(p: Programme): Promise<string | null> {
  const mark = markFor(p.funder)
  if (mark.kind !== 'icon') return null
  // On a white tile, as on the page: most favicons are drawn for a light background.
  const png = await sharp(join(process.cwd(), 'public', mark.src))
    .resize(72, 72, { fit: 'contain', background: '#fff' })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#fff' })
    .flatten({ background: '#fff' })
    .png()
    .toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

function Card({ c, mark }: { c: CardContent; mark: string | null }) {
  return (
    <div style={{ width: OG_WIDTH, height: OG_HEIGHT, display: 'flex', color: ink, fontFamily: 'Inter' }}>
      {/* Sizes, not padding: Satori adds padding to a box's height. */}
      <div style={{ marginTop: 54, marginLeft: 72, width: TEXT_WIDTH, height: OG_HEIGHT - 54 - 56, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', fontFamily: 'Serif', fontSize: 32 }}>
          <svg viewBox="0 0 24 24" width="32" height="32" style={{ marginRight: 10 }}>
            <path d="M12 2.5c-4.6 3.4-7 7-7 10.6a7 7 0 0 0 14 0c0-3.6-2.4-7.2-7-10.6Z" fill={ink2} />
            <path d="M12 21.5V9.5m0 4.5 3.2-2.6M12 17l-3.4-2.8" fill="none" stroke={green} stroke-width="1.8" stroke-linecap="round" />
          </svg>
          <span>naturefunding</span>
          <span style={{ color: ink2 }}>.org</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'block', fontFamily: 'Serif', fontSize: titleSize(c.title), lineHeight: 1.1, letterSpacing: '-0.01em', lineClamp: 4 }}>
            {c.title}
          </div>
          {c.funder && (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 22, fontSize: 28, color: ink2 }}>
              {mark && <img src={mark} width={40} height={40} style={{ borderRadius: 7, marginRight: 14, flexShrink: 0 }} />}
              <div style={{ display: 'block', lineClamp: 1 }}>{c.funder}</div>
            </div>
          )}
        </div>
        {c.facts.length > 0 && (
          <div style={{ display: 'flex', borderTop: `1px solid rgba(190,204,194,0.35)`, paddingTop: 22 }}>
            {c.facts.map((f, i) => (
              <div key={f.label} style={{ display: 'flex', flexDirection: 'column', flex: f.label === 'Where' ? 1.5 : 1, marginLeft: i ? 28 : 0, minWidth: 0 }}>
                <div style={{ fontSize: 20, color: ink2 }}>{f.label}</div>
                <div style={{ display: 'block', marginTop: 6, fontSize: 24, fontWeight: 600, lineHeight: 1.2, lineClamp: 2 }}>{f.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

let background: Promise<Buffer> | undefined
/** The green card with the home band's forest down the right edge, fading into the green. Made once per build. */
const makeBackground = () =>
  (background ??= (async () => {
    const width = OG_WIDTH - ART_LEFT
    const art = await sharp(join(process.cwd(), 'public/img/header/hero-1236.jpg'))
      .resize(width, OG_HEIGHT, { fit: 'cover', position: 'left' })
      .toBuffer()
    const fade = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${OG_HEIGHT}"><defs><linearGradient id="g"><stop offset="0" stop-color="${green}"/><stop offset="0.3" stop-color="${green}" stop-opacity="0.5"/><stop offset="0.65" stop-color="${green}" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
    )
    return sharp({ create: { width: OG_WIDTH, height: OG_HEIGHT, channels: 3, background: green } })
      .composite([{ input: await sharp(art).composite([{ input: fade }]).toBuffer(), left: ART_LEFT, top: 0 }])
      .png()
      .toBuffer()
  })())

/**
 * Cards already drawn by an earlier build on this machine, keyed by what each card says and by this renderer's
 * own source, fonts and art. CI starts empty and draws every card (about a minute).
 */
const CACHE_DIR = join(process.cwd(), 'node_modules/.cache/og-cards')
let rendererKey: string | undefined
const rendererHash = () =>
  (rendererKey ??= (() => {
    const h = createHash('sha256')
    for (const f of ['src/lib/og-card.tsx', 'src/lib/og-fonts.ts', 'public/img/header/hero-1236.jpg']) h.update(readFileSync(join(process.cwd(), f)))
    for (const { file } of ogFontFiles()) h.update(file).update(readFileSync(join(OG_FONT_DIR, file)))
    return h.digest('hex').slice(0, 10)
  })())

/** The card as a JPEG. */
export async function renderCard(p: Programme): Promise<Buffer> {
  const cached = join(CACHE_DIR, `${p.id}-${cardVersion(p)}-${rendererHash()}.jpg`)
  if (existsSync(cached)) return readFileSync(cached)
  const jpeg = await drawCard(p)
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(cached, jpeg)
  return jpeg
}

async function drawCard(p: Programme): Promise<Buffer> {
  const svg = await satori(<Card c={cardContent(p)} mark={await markData(p)} />, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: loadFonts(),
    loadAdditionalAsset: fetchMissing,
  })
  return sharp(await makeBackground())
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
}
