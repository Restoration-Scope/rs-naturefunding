/**
 * Finds a legal way to read a research paper. Looks the paper up in OpenAlex (a free, open index
 * of scholarly works that carries Unpaywall's open-access data) and prints, per paper: the best
 * open copy (publisher, repository or preprint) with its version, or, when there is none, the
 * authors and their institutions so you can ask one of them for a copy. No shadow libraries.
 *   bun scripts/papers/find.ts <doi | title> [<doi | title> ...]
 * OPENALEX_API_KEY (free) comes from the env or Keychain ("openalex OPENALEX_API_KEY"); without
 * it, lookups share the network's small free daily budget. Get one: bun scripts/papers/setup-key.ts
 */
import { spawnSync } from 'node:child_process'

const API = 'https://api.openalex.org/works'

type Location = {
  is_oa: boolean
  landing_page_url: string | null
  pdf_url: string | null
  version: string | null
  license: string | null
  source: { display_name: string } | null
}

type Work = {
  id: string
  doi: string | null
  display_name: string
  publication_year: number | null
  primary_location: Location | null
  open_access: { is_oa: boolean; oa_status: string; oa_url: string | null }
  best_oa_location: Location | null
  locations: Location[]
  authorships: {
    author: { display_name: string; orcid: string | null }
    institutions: { display_name: string }[]
    is_corresponding?: boolean
  }[]
}

const VERSIONS: Record<string, string> = {
  publishedVersion: 'published version',
  acceptedVersion: 'accepted manuscript (same text, before the publisher’s layout)',
  submittedVersion: 'preprint (before peer review)',
}

function doiOf(input: string): string | null {
  const m = input.match(/10\.\d{4,9}\/\S+/)
  return m ? m[0].replace(/[.,;]$/, '') : null
}

const KEY =
  process.env.OPENALEX_API_KEY ||
  spawnSync('security', ['find-generic-password', '-a', 'alegria', '-s', 'openalex OPENALEX_API_KEY', '-w'], {
    encoding: 'utf8',
  }).stdout.trim()

async function get(url: string): Promise<any> {
  const res = await fetch(url, KEY ? { headers: { Authorization: `Bearer ${KEY}` } } : {})
  if (res.status === 404) return null
  if (res.status === 429)
    throw new Error(
      KEY
        ? 'OpenAlex key’s daily budget used up (rs-allometrics shares it). It resets at midnight UTC.'
        : 'OpenAlex daily budget used up. Get a free key: bun scripts/papers/setup-key.ts',
    )
  if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${url}`)
  return res.json()
}

// A title search returns the best match plus the runners-up, in case the best one is wrong.
async function lookUp(input: string): Promise<{ work: Work | null; others: Work[] }> {
  const doi = doiOf(input)
  if (doi) return { work: await get(`${API}/doi:${encodeURIComponent(doi)}`), others: [] }
  const found = await get(`${API}?search=${encodeURIComponent(input)}&per-page=3`)
  const [work = null, ...others] = found?.results ?? []
  return { work, others }
}

function where(l: Location): string {
  // The URL's host, not OpenAlex's source name, which is sometimes wrong for repositories.
  const host = new URL((l.pdf_url ?? l.landing_page_url)!).host.replace(/^www\./, '')
  const version = l.version ? VERSIONS[l.version] ?? l.version : 'version not stated'
  return `${host}, ${version}${l.license ? `, ${l.license}` : ''}`
}

function report(input: string, w: Work | null, others: Work[]): string {
  if (!w) return `✗ ${input}\n  Not found in OpenAlex. Try the DOI, or the exact title.\n`
  const lines = [`${w.display_name} (${w.publication_year ?? 'n.d.'})`]
  if (w.doi) lines.push(`  ${w.doi}`)
  const urls = new Set<string>()
  const open = [w.best_oa_location, ...w.locations].filter((l): l is Location => {
    const url = l?.is_oa && (l.pdf_url || l.landing_page_url)
    if (!url || urls.has(url)) return false
    urls.add(url)
    return true
  })
  if (w.open_access.is_oa && open.length) {
    lines.unshift('✓ Open copy')
    for (const l of open.slice(0, 3)) lines.push(`  → ${l.pdf_url ?? l.landing_page_url}\n    ${where(l)}`)
  } else {
    lines.unshift('✗ No open copy')
    lines.push('  Ask an author (most send a copy within a few days):')
    const authors = w.authorships.filter((a) => a.is_corresponding)
    for (const a of (authors.length ? authors : [w.authorships[0], w.authorships.at(-1)]).filter(
      (a, i, all) => a && all.indexOf(a) === i,
    )) {
      const inst = a!.institutions.map((x) => x.display_name).join('; ')
      lines.push(`  · ${a!.author.display_name}${inst ? `, ${inst}` : ''}${a!.author.orcid ? ` (${a!.author.orcid})` : ''}`)
    }
    lines.push(`  Or request it on ResearchGate: https://www.researchgate.net/search/publication?q=${encodeURIComponent(w.display_name)}`)
  }
  if (others.length) {
    lines.push('  Not this paper? Other matches (rerun with the DOI):')
    for (const o of others) lines.push(`  · ${o.display_name} (${o.publication_year ?? 'n.d.'}) ${o.doi ?? o.id}`)
  }
  return lines.join('\n') + '\n'
}

const inputs = process.argv.slice(2)
if (!inputs.length) {
  console.error('Usage: bun scripts/papers/find.ts <doi | title> [<doi | title> ...]')
  process.exit(1)
}
for (const input of inputs) {
  const { work, others } = await lookUp(input)
  console.log(report(input, work, others))
}
