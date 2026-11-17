// Renders sample digests from the real git history into digest/preview/*.html (gitignored), with the same code
// the Worker runs. Run from the repo root:
//   bun digest/scripts/preview.ts                      this week: the real events of the last 7 days
//   bun digest/scripts/preview.ts --launch KE reforestation
//                                                      launch week: the seed counts as new, for a subscriber
//                                                      who joined the day before, with optional where/approach
//   bun digest/scripts/preview.ts --since 2026-11-05 r:asia species_conservation --currency USD
//                                                      a subscriber's first email: what the daily run would send
//                                                      today to someone whose digest starts on that date
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadProgrammes } from '../../src/data/load'
import { buildDigest } from '../src/digest'
import { digestEmail } from '../src/email'
import { cleanPrefs } from '../src/match'
import { eventsFromHistory } from './history'
import { loadPagePaths } from './pages'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args.splice(i, 2)[1]
}
const currency = flag('--currency') ?? ''
const sinceArg = flag('--since')
const launch = args[0] === '--launch'
const [where = '', approach = ''] = launch ? args.slice(1) : args
const programmes = new Map(loadProgrammes().map((p) => [p.id, p]))
const events = eventsFromHistory(sinceArg ? 365 : 60, 'HEAD', { baseline: launch })
const now = new Date()
const since = sinceArg
  ? new Date(sinceArg)
  : launch
    ? new Date(Date.parse(events[0]?.at ?? now.toISOString()) - 86_400_000)
    : new Date(now.getTime() - 7 * 86_400_000)
const prefs = cleanPrefs(where, approach ? [approach] : [])
const digest = buildDigest(events, programmes, prefs, since.toISOString(), now.toISOString())

console.log(`${events.length} events in history (${launch ? 'launch replay' : 'last 60 days'}); ${digest.total} for this subscriber since ${since.toISOString().slice(0, 10)}`)
if (digest.items.length === 0) {
  console.log('Nothing new: no email is sent.')
  process.exit(0)
}
const email = digestEmail({
  site: 'https://naturefunding.org',
  pages: loadPagePaths(),
  digest,
  prefs,
  currency,
  since: since.toISOString(),
  unsubscribeUrl: 'https://email.naturefunding.org/unsubscribe?t=sample',
  manageUrl: 'https://naturefunding.org/digest/',
})
mkdirSync('digest/preview', { recursive: true })
const name = `digest/preview/${sinceArg ? `since-${sinceArg.slice(0, 10)}` : launch ? 'launch' : 'week'}-${(prefs.where || 'anywhere').replace(':', '-')}-${prefs.approaches[0] ?? 'any'}${currency ? `-${currency}` : ''}`
writeFileSync(`${name}.html`, email.html)
writeFileSync(`${name}.txt`, `Subject: ${email.subject}\n\n${email.text}`)
console.log(`Subject: ${email.subject}\n${name}.html`)
