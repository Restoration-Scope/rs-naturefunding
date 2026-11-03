// Renders sample digests from the real git history into digest/preview/*.html (gitignored), with the same code
// the Worker runs. Run from the repo root:
//   bun digest/scripts/preview.ts                      this week: the real events of the last 7 days
//   bun digest/scripts/preview.ts --launch KE reforestation
//                                                      launch week: the seed counts as new, for a subscriber
//                                                      who joined the day before, with optional where/approach
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadProgrammes } from '../../src/data/load'
import { buildDigest } from '../src/digest'
import { digestEmail } from '../src/email'
import { cleanPrefs } from '../src/match'
import { eventsFromHistory } from './history'

const args = process.argv.slice(2)
const launch = args[0] === '--launch'
const [where = '', approach = ''] = launch ? args.slice(1) : args
const programmes = new Map(loadProgrammes().map((p) => [p.id, p]))
const events = eventsFromHistory(60, 'HEAD', { baseline: launch })
const now = new Date()
const since = launch ? new Date(Date.parse(events[0]?.at ?? now.toISOString()) - 86_400_000) : new Date(now.getTime() - 7 * 86_400_000)
const prefs = cleanPrefs(where, approach ? [approach] : [])
const digest = buildDigest(events, programmes, prefs, since.toISOString(), now.toISOString())

console.log(`${events.length} events in history (${launch ? 'launch replay' : 'last 60 days'}); ${digest.total} for this subscriber since ${since.toISOString().slice(0, 10)}`)
if (digest.items.length === 0) {
  console.log('Nothing new: no email is sent.')
  process.exit(0)
}
const email = digestEmail({
  site: 'https://naturefunding.org',
  digest,
  prefs,
  since: since.toISOString(),
  unsubscribeUrl: 'https://email.naturefunding.org/unsubscribe?t=sample',
  manageUrl: 'https://naturefunding.org/digest/',
})
mkdirSync('digest/preview', { recursive: true })
const name = `digest/preview/${launch ? 'launch' : 'week'}-${prefs.where || 'anywhere'}-${prefs.approaches[0] ?? 'any'}`
writeFileSync(`${name}.html`, email.html)
writeFileSync(`${name}.txt`, `Subject: ${email.subject}\n\n${email.text}`)
console.log(`Subject: ${email.subject}\n${name}.html`)
