/**
 * Requests a free OpenAlex API key for an email address and keeps it in Keychain
 * ("openalex OPENALEX_API_KEY", account alegria). OpenAlex emails a link; the key works once it
 * is clicked. Prints no key. Rerunning keeps an existing key.
 *   bun scripts/papers/setup-key.ts --email <address>
 */
import { spawnSync } from 'node:child_process'

const SERVICE = 'openalex OPENALEX_API_KEY'
const has = spawnSync('security', ['find-generic-password', '-a', 'alegria', '-s', SERVICE]).status === 0
if (has) {
  console.log(`${SERVICE} is already in Keychain.`)
  process.exit(0)
}
const email = process.argv[process.argv.indexOf('--email') + 1]
if (!process.argv.includes('--email') || !email?.includes('@')) {
  console.error('Usage: bun scripts/papers/setup-key.ts --email <address>')
  process.exit(1)
}
const res = await fetch('https://api.openalex.org/api-keys', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
})
const body: Record<string, unknown> = await res.json().catch(() => ({}))
if (body.code === 'account_exists') {
  // One key per email: reuse rs-allometrics' Keychain copy if it is on this Mac.
  console.error(`${body.message}\nIf rs-allometrics has it: k=$(security find-generic-password -a alegria -s "rs-allometrics OPENALEX_API_KEY" -w) && printf '%s\\n%s\\n' "$k" "$k" | security add-generic-password -a alegria -s "${SERVICE}" -U -w`)
  process.exit(1)
}
const key = Object.entries(body).find(([k, v]) => /key/i.test(k) && typeof v === 'string')?.[1] as string | undefined
if (!res.ok || !key) {
  console.error(`OpenAlex answered ${res.status} without a key. Fields: ${Object.keys(body).join(', ') || 'none'}`)
  process.exit(1)
}
// -w last with no value makes security read the secret from stdin, so it never sits in argv.
const saved = spawnSync('security', ['add-generic-password', '-a', 'alegria', '-s', SERVICE, '-U', '-w'], {
  input: `${key}\n${key}\n`,
})
if (saved.status !== 0) {
  console.error('Could not save the key to Keychain.')
  process.exit(1)
}
console.log(`Saved ${SERVICE} to Keychain. Click the link OpenAlex emailed to ${email} to switch it on.`)
