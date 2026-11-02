// Connects the digest to naturefunding.org's own free Resend account, once: asks for a Full access API key with
// typing hidden, or takes it from the clipboard with --from-clipboard (or reuses the one in Keychain), keeps it in Keychain (service "naturefunding RESEND_API_KEY"), and adds
// naturefunding.org as a sending domain. It prints names and statuses only, never the key, and changes no DNS: the
// records it lists go into Cloudflare at deploy (README: Deploy). Run from the repo root in a terminal:
//   bun digest/scripts/setup-resend.ts [--from-clipboard]
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'

const ACCOUNT = 'alegria'
const SERVICE = 'naturefunding RESEND_API_KEY'
const DOMAIN = 'naturefunding.org'
const API = 'https://api.resend.com'

const keychainRead = () => {
  const r = spawnSync('security', ['find-generic-password', '-a', ACCOUNT, '-s', SERVICE, '-w'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function keychainWrite(value: string) {
  // `security -i` reads its command from stdin, so the key never appears in a process argument.
  const r = spawnSync('security', ['-i'], { input: `add-generic-password -U -a "${ACCOUNT}" -s "${SERVICE}" -w "${value}"\n`, encoding: 'utf8' })
  if (r.status !== 0 || keychainRead() !== value) throw new Error(`Keychain write failed for ${SERVICE}`)
}

async function askHidden(prompt: string) {
  if (!process.stdin.isTTY) throw new Error('Run this in a terminal, so typing can be hidden.')
  process.stdout.write(prompt)
  if (spawnSync('stty', ['-echo'], { stdio: 'inherit' }).status !== 0) throw new Error('Could not hide typing in this terminal.')
  const lines = createInterface({ input: process.stdin, terminal: false })
  try {
    return (await new Promise<string>((resolve) => lines.once('line', resolve))).trim()
  } finally {
    lines.close()
    spawnSync('stty', ['echo'], { stdio: 'inherit' })
    process.stdout.write('\n')
  }
}

type Domain = { id: string; name: string; status: string; records?: { record: string; type: string; name: string; value: string; priority?: number; status: string }[] }

async function resend<T>(key: string, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T }
}

// Listing domains needs a Full access key, so it checks the key and its rights in one call.
async function keyProblem(key: string) {
  const { status, body } = await resend<{ name?: string; message?: string }>(key, '/domains')
  if (status === 200) return ''
  return status === 401 && body.name === 'restricted_api_key' ? 'it is a Sending access key, not Full access' : `Resend answered ${status}: ${body.message ?? body.name ?? 'no reason given'}`
}

let key = keychainRead()
if (key && (await keyProblem(key))) {
  console.log(`The key in Keychain (${SERVICE}) isn't a working Full access key; asking for a new one.`)
  key = ''
}
if (!key) {
  let value: string
  if (process.argv.includes('--from-clipboard')) {
    value = spawnSync('pbpaste', { encoding: 'utf8' }).stdout.trim()
  } else {
    console.log('In naturefunding.org’s free Resend account: API Keys → Create API key → Permission "Full access" → copy it.')
    spawnSync('open', ['https://resend.com/api-keys'])
    value = await askHidden('Paste the Resend API key (typing stays hidden): ')
  }
  if (!/^re_[A-Za-z0-9_]{20,}$/.test(value)) throw new Error('That doesn’t look like a Resend key (re_…). Nothing was stored.')
  const problem = await keyProblem(value)
  if (problem) throw new Error(`Resend refused that key: ${problem}. Nothing was stored.`)
  keychainWrite(value)
  key = value
  console.log(`Stored in Keychain: ${SERVICE}`)
} else {
  console.log(`Using the key in Keychain: ${SERVICE}`)
}

const list = await resend<{ data: Domain[] }>(key, '/domains')
let domain = list.body.data?.find((d) => d.name === DOMAIN)
if (!domain) {
  const made = await resend<Domain & { message?: string }>(key, '/domains', { method: 'POST', body: JSON.stringify({ name: DOMAIN, region: 'us-east-1' }) })
  if (made.status >= 300) throw new Error(`Resend wouldn’t add ${DOMAIN}: ${made.body.message ?? made.status}`)
  domain = made.body
  console.log(`Added ${DOMAIN} to Resend.`)
}
// Open and click tracking stay off: the privacy page promises no tracking.
await resend(key, `/domains/${domain.id}`, { method: 'PATCH', body: JSON.stringify({ open_tracking: false, click_tracking: false }) })
const full = (await resend<Domain>(key, `/domains/${domain.id}`)).body
console.log(`${DOMAIN}: ${full.status}; tracking off`)
for (const r of full.records ?? []) console.log(`  ${r.record} ${r.status}: ${r.type} ${r.name} ${r.priority === undefined ? '' : `${r.priority} `}${r.value}`)
if (full.status !== 'verified') console.log('These DNS records go into Cloudflare at deploy; nothing in DNS was changed.')
