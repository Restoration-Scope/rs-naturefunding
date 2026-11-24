import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { z } from 'zod'
import { countryList, programme, sources as sourcesSchema, type CountryList, type Evidence, type Programme, type Source } from './schema'
import { checkSponsors, type Sponsor } from './sponsors'

export type DataSet = { programmes: Programme[]; sources: Source[]; lists: CountryList[]; sponsors: Sponsor[] }
export type CheckResult = DataSet & { issues: string[] }

const formatIssues = (where: string, error: z.ZodError) =>
  error.issues.map((i) => `${where}: ${i.path.join('.') || '(root)'}: ${i.message}`)

export function evidenceOf(p: Programme): Evidence[] {
  return [
    ...Object.values(p.evidence).flat(),
    ...p.calls.flatMap((c) => [c.evidence.status, c.evidence.opens, c.evidence.deadline, c.evidence.recurring, c.evidence.countries]),
  ].filter((e): e is Evidence => e !== undefined)
}

/** Reads and checks every programme file, and the watch list unless `sourcesFile` is null. */
export function checkData(
  programmesDir = join(process.cwd(), 'data', 'programmes'),
  sourcesFile: string | null = join(process.cwd(), 'data', 'sources.json'),
): CheckResult {
  const issues: string[] = []
  const programmes: Programme[] = []

  const files = existsSync(programmesDir) ? readdirSync(programmesDir).filter((f) => f.endsWith('.json')).sort() : []
  for (const file of files) {
    const where = `programmes/${file}`
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(join(programmesDir, file), 'utf8'))
    } catch (e) {
      issues.push(`${where}: invalid JSON: ${(e as Error).message}`)
      continue
    }
    const parsed = programme.safeParse(raw)
    if (!parsed.success) {
      issues.push(...formatIssues(where, parsed.error))
      continue
    }
    if (parsed.data.id !== basename(file, '.json')) issues.push(`${where}: id ${parsed.data.id} must match the file name`)
    programmes.push(parsed.data)
  }

  const byId = new Map(programmes.map((p) => [p.id, p]))
  for (const p of programmes) {
    if (p.parent === null) continue
    const parent = byId.get(p.parent)
    if (!parent) issues.push(`programmes/${p.id}.json: parent ${p.parent} does not exist`)
    else if (parent.parent !== null) issues.push(`programmes/${p.id}.json: parent ${p.parent} has a parent itself; one level only`)
  }

  // A programme that points to an official list holds every country on it, so the page never misses one.
  const listsDir = join(programmesDir, '..', 'lists')
  const lists = new Map<string, CountryList>()
  for (const file of existsSync(listsDir) ? readdirSync(listsDir).filter((f) => f.endsWith('.json')) : []) {
    const parsed = countryList.safeParse(JSON.parse(readFileSync(join(listsDir, file), 'utf8')))
    if (!parsed.success) issues.push(...formatIssues(`lists/${file}`, parsed.error))
    else lists.set(parsed.data.id, parsed.data)
  }
  for (const p of programmes) {
    const g = p.geography
    if (g?.scope !== 'countries' || !g.list) continue
    const list = lists.get(g.list)
    if (!list) issues.push(`programmes/${p.id}.json: geography.list ${g.list} is not in data/lists`)
    else {
      const missing = list.countries.filter((c) => !g.countries.includes(c))
      if (missing.length) issues.push(`programmes/${p.id}.json: geography.countries lacks ${missing.join(', ')} from ${list.name}`)
    }
  }

  const { sponsors, issues: sponsorIssues } = checkSponsors(join(programmesDir, '..', 'sponsors'), new Set(byId.keys()))
  issues.push(...sponsorIssues)

  let sources: Source[] = []
  if (sourcesFile !== null) {
    if (!existsSync(sourcesFile)) issues.push('sources.json: missing')
    else {
      const parsed = sourcesSchema.safeParse(JSON.parse(readFileSync(sourcesFile, 'utf8')))
      if (!parsed.success) issues.push(...formatIssues('sources.json', parsed.error))
      else sources = parsed.data
    }
    const seen = new Set<string>()
    for (const s of sources) {
      if (seen.has(s.id)) issues.push(`sources.json: duplicate id ${s.id}`)
      seen.add(s.id)
      if (!byId.has(s.programme_id)) issues.push(`sources.json: ${s.id} points to missing programme ${s.programme_id}`)
    }
    for (const p of programmes) {
      const watched = new Set(sources.filter((s) => s.programme_id === p.id).map((s) => s.url))
      if (watched.size === 0) issues.push(`sources.json: no source for programme ${p.id}`)
      for (const url of new Set(evidenceOf(p).map((e) => e.source_url))) {
        if (!watched.has(url)) issues.push(`sources.json: ${p.id} cites ${url} but no source watches it`)
      }
    }
  }

  return { programmes, sources, lists: [...lists.values()], sponsors, issues }
}

/** For the site build: every file valid or the build fails. */
export function loadData(): DataSet {
  const { programmes, sources, lists, sponsors, issues } = checkData()
  if (issues.length > 0) throw new Error(`data/ has ${issues.length} problem(s):\n${issues.join('\n')}`)
  return { programmes, sources, lists, sponsors }
}

/** Every programme, validated, sorted by id. */
export const loadProgrammes = (): Programme[] => loadData().programmes
