/**
 * Organisation marks: the small favicon shown beside a funder or administrator, self-hosted in
 * public/marks/ by `bun run sync-favicons`, or a monogram when that script found no usable icon.
 * Pages read only data/marks.json and the files it names; nothing is fetched at build or view time.
 */
import manifest from '../../data/marks.json'

export type Org = { name: string; url: string }

/** One organisation domain in data/marks.json. Either `file` is set, or `fallback` says why not. */
export type MarkEntry = {
  domain: string
  /** The organisation names in the data that use this domain. */
  orgs: string[]
  /** The page the icon link was read from (the domain's homepage). */
  homepage: string
  /** The icon URL the stored file was made from; null for a fallback. */
  source: string | null
  /** The source's own size in pixels (the shorter side); null for a fallback or a vector icon. */
  source_px: number | null
  /** When the script last fetched this domain (ISO time). */
  fetched_at: string
  /** Path under public/, e.g. "marks/rufford.org.webp"; null for a fallback. */
  file: string | null
  bytes: number | null
  /** Why there is no icon: blocked by robots.txt, a bot check, no usable icon… */
  fallback: string | null
}

export type Mark =
  | { kind: 'icon'; domain: string; src: string; letters: string }
  | { kind: 'monogram'; domain: string | null; letters: string; reason: string }

export const marks = manifest as Record<string, MarkEntry>

/** The key marks are stored under: the URL's host, lowercased, without a leading "www.". */
export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'de', 'del', 'des', 'du', 'for', 'in', 'la', 'le', 'les', 'of', 'on', 'para', 'the', 'to', 'und', 'with',
])

/**
 * One or two letters for the fallback tile: an acronym's first two letters ("UNDP Peru" → "UN"),
 * else the first letters of the first two words that count ("The Rufford Foundation" → "RF"),
 * leaving out anything in brackets.
 */
export function monogram(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s\-–—/,:;&+]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0 && !SMALL_WORDS.has(w.toLowerCase()))
  const first = words[0]
  if (!first) return '?'
  if (first.length >= 2 && first === first.toUpperCase() && /\p{L}/u.test(first)) return [...first].slice(0, 2).join('')
  const second = words[1]
  return ([...first][0]! + (second ? [...second][0]! : '')).toUpperCase()
}

/** The mark for an organisation: its stored icon, else a monogram with the reason. */
export function markFor(org: Org, entries: Record<string, MarkEntry> = marks): Mark {
  const letters = monogram(org.name)
  const domain = domainOf(org.url)
  if (!domain) return { kind: 'monogram', domain: null, letters, reason: 'no valid URL' }
  const entry = entries[domain]
  if (!entry) return { kind: 'monogram', domain, letters, reason: 'not synced yet (run bun run sync-favicons)' }
  if (entry.file) return { kind: 'icon', domain, src: `/${entry.file}`, letters }
  return { kind: 'monogram', domain, letters, reason: entry.fallback ?? 'no icon' }
}
