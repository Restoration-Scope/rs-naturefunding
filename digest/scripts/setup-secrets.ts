// Sets the deployed Worker's two secrets, once and again on a rerun, printing names only:
// - RESEND_API_KEY: a Sending access key for naturefunding.org alone, minted with the Full access key that
//   setup-resend.ts keeps in Keychain. It is kept in Keychain the moment it exists, so a rerun reuses it.
// - LIST_SECRET: 32 random bytes that seal the confirm and unsubscribe links, also kept in Keychain.
// Values go to wrangler through stdin only. Run from the repo root after the Worker's first deploy:
//   bun digest/scripts/setup-secrets.ts
import { spawnSync } from 'node:child_process'

const ACCOUNT = 'alegria'
const DOMAIN = 'naturefunding.org'

const keychainRead = (service: string) => {
  const r = spawnSync('security', ['find-generic-password', '-a', ACCOUNT, '-s', service, '-w'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function keychainWrite(service: string, value: string) {
  // `security -i` reads its command from stdin, so the value never appears in a process argument.
  const r = spawnSync('security', ['-i'], { input: `add-generic-password -U -a "${ACCOUNT}" -s "${service}" -w "${value}"\n`, encoding: 'utf8' })
  if (r.status !== 0 || keychainRead(service) !== value) throw new Error(`Keychain write failed for ${service}`)
}

async function mintSendingKey() {
  const full = keychainRead('naturefunding RESEND_API_KEY')
  if (!full) throw new Error('No Full access key in Keychain: run bun digest/scripts/setup-resend.ts first.')
  const api = (path: string, init?: RequestInit) =>
    fetch(`https://api.resend.com${path}`, { ...init, headers: { Authorization: `Bearer ${full}`, 'Content-Type': 'application/json' } }).then((r) => r.json())
  const domain = ((await api('/domains')) as { data: { id: string; name: string; status: string }[] }).data.find((d) => d.name === DOMAIN)
  if (domain?.status !== 'verified') throw new Error(`${DOMAIN} isn't verified in Resend yet (${domain?.status ?? 'missing'}).`)
  const made = (await api('/api-keys', { method: 'POST', body: JSON.stringify({ name: 'naturefunding-digest Worker', permission: 'sending_access', domain_id: domain.id }) })) as { token?: string; message?: string }
  if (!made.token) throw new Error(`Resend wouldn't make a sending key: ${made.message ?? 'no reason given'}`)
  return made.token
}

async function secret(name: string, service: string, mint: () => Promise<string> | string) {
  let value = keychainRead(service)
  if (!value) {
    value = await mint()
    keychainWrite(service, value)
    console.log(`Made and kept in Keychain: ${service}`)
  }
  const r = spawnSync('bunx', ['wrangler', 'secret', 'put', name, '--config', 'digest/wrangler.jsonc'], { input: value, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`wrangler secret put ${name} failed:\n${r.stderr.slice(-500)}`)
  console.log(`Set on the Worker: ${name}`)
}

await secret('RESEND_API_KEY', 'naturefunding-digest RESEND_API_KEY', mintSendingKey)
await secret('LIST_SECRET', 'naturefunding-digest LIST_SECRET', () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))
