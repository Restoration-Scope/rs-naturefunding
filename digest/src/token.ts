// Links in emails carry a sealed token (AES-GCM under a key derived from LIST_SECRET): the reader can't see or
// change what's inside, and nothing about a sign-up is stored until the address confirms. Rotating the secret
// voids open confirmation and unsubscribe links.

export type ConfirmClaim = { k: 'confirm'; email: string; where: string; approaches: string[]; consent: string; at: number }
export type UnsubscribeClaim = { k: 'unsubscribe'; id: string }
export type Claim = ConfirmClaim | UnsubscribeClaim

export const CONFIRM_TTL_MS = 3 * 86_400_000

const enc = new TextEncoder()
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const unb64url = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))

const keys = new Map<string, Promise<CryptoKey>>()
function keyFor(secret: string) {
  let k = keys.get(secret)
  if (!k) {
    k = crypto.subtle
      .importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey'])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('naturefunding-digest'), info: enc.encode('link-token-v1') },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      )
    keys.set(secret, k)
  }
  return k
}

export async function seal(claim: Claim, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret), enc.encode(JSON.stringify(claim))))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return b64url(out)
}

/** The claim, or null for a token that was changed, sealed under another secret, or isn't one. */
export async function open(token: string, secret: string): Promise<Claim | null> {
  try {
    const raw = unb64url(token)
    if (raw.length < 13) return null
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, await keyFor(secret), raw.subarray(12))
    return JSON.parse(new TextDecoder().decode(pt)) as Claim
  } catch {
    return null
  }
}

/** A keyed hash of an address, for counting sign-up attempts without storing the address. */
export async function addressHash(email: string, secret: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`attempt:${email}`))))
}
