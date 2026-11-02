// Writes digest/.dev.vars for local runs, printing names only. LIST_SECRET is generated once and kept;
// RESEND_API_KEY comes from Keychain (service "naturefunding RESEND_API_KEY", else Restoration Scope's key, used
// here only with Resend's test sender and recipient). Run from the repo root: bun digest/scripts/setup-local.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const path = 'digest/.dev.vars'
const current = new Map(
  existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    : [],
)
const keychain = (service: string) => {
  const r = Bun.spawnSync(['security', 'find-generic-password', '-a', 'alegria', '-s', service, '-w'])
  return r.exitCode === 0 ? r.stdout.toString().trim() : ''
}
const example = new Map(
  readFileSync('digest/.dev.vars.example', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const values = new Map([...example, ...current])
if (!values.get('LIST_SECRET')) values.set('LIST_SECRET', Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))
if (!values.get('RESEND_API_KEY')) {
  const key = keychain('naturefunding RESEND_API_KEY') || keychain('restoration-scope RESEND_CONTACTS_API_KEY')
  if (!key) {
    console.error('No Resend key in Keychain (naturefunding RESEND_API_KEY). Local sign-ups will fail to send.')
  }
  values.set('RESEND_API_KEY', key)
}
writeFileSync(path, [...values].map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
console.log(`${path}: ${[...values.keys()].map((k) => `${k}${values.get(k) ? '' : ' (empty)'}`).join(', ')}`)
