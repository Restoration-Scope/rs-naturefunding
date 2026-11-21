/**
 * Servers that leave their intermediate certificate out of the handshake fail with "unable to verify the first
 * certificate", though browsers read them: browsers fetch the missing intermediate from the address the server's
 * own certificate names (Authority Information Access, "CA Issuers"). This does the same, then retries with that
 * intermediate added to the trusted roots. Verification is never turned off: the intermediate is only a link in
 * the chain (an extra CA without the roots trusts nothing), it must be a CA that signed the server's certificate,
 * and the chain must reach a root we already trust, so a forged or self-signed download is refused.
 */
import { X509Certificate } from 'node:crypto'
import tls from 'node:tls'

/** The handshake errors a missing intermediate causes. */
const MISSING_ISSUER = /^(?:UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|UNABLE_TO_GET_ISSUER_CERT)$/
export const missingIssuer = (e: unknown) => MISSING_ISSUER.test((e as { code?: string })?.code ?? '')

/** Intermediates followed at most from a server certificate up to a trusted root. */
const MAX_DEPTH = 3

export type ChainDeps = {
  /** The server's own certificate. The connection that reads it sends nothing and is closed at once. */
  leaf: (host: string, port: number) => Promise<X509Certificate | null>
  /** The bytes at a CA Issuers address. */
  download: (url: string) => Promise<Uint8Array>
  roots: () => X509Certificate[]
}

let parsedRoots: X509Certificate[] | null = null
const systemRoots = () => (parsedRoots ??= tls.rootCertificates.map((pem) => new X509Certificate(pem)))

export const defaultDeps: ChainDeps = {
  leaf: (host, port) =>
    new Promise((resolve) => {
      // Unverified on purpose, to read the certificate the server presents; no request is ever sent on it.
      const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 15_000 }, () => {
        const raw = socket.getPeerCertificate()?.raw
        socket.destroy()
        resolve(raw ? new X509Certificate(raw) : null)
      })
      socket.on('error', () => resolve(null))
      socket.on('timeout', () => (socket.destroy(), resolve(null)))
    }),
  download: async (url) => {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  },
  roots: systemRoots,
}

/** The CA Issuers addresses in a certificate's Authority Information Access. */
export const caIssuers = (cert: X509Certificate) => [...(cert.infoAccess ?? '').matchAll(/CA Issuers - URI:(\S+)/g)].map((m) => m[1]!).filter((u) => /^https?:\/\//.test(u))

/** The certificates in a download: one DER or PEM certificate, PEM blocks, or a PKCS#7 bundle (.p7c). */
export function certificatesIn(bytes: Uint8Array): X509Certificate[] {
  const text = new TextDecoder('latin1').decode(bytes)
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    return [...text.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].flatMap((m) => tryCert(m[0]))
  }
  const one = tryCert(bytes)
  return one.length ? one : derCertificates(bytes)
}

const tryCert = (b: Uint8Array | string) => {
  try {
    return [new X509Certificate(b)]
  } catch {
    return []
  }
}

/** Every DER SEQUENCE inside a PKCS#7 structure that parses as a certificate. */
function derCertificates(bytes: Uint8Array): X509Certificate[] {
  const out: X509Certificate[] = []
  const walk = (at: number, end: number, depth: number) => {
    while (at < end && depth < 8) {
      const tag = bytes[at]!
      let len = bytes[at + 1]!
      let head = 2
      if (len & 0x80) {
        const n = len & 0x7f
        if (n === 0 || n > 4) return
        len = 0
        for (let i = 0; i < n; i++) len = len * 256 + bytes[at + 2 + i]!
        head = 2 + n
      }
      const body = at + head
      if (body + len > end) return
      if (tag === 0x30) {
        const cert = tryCert(bytes.subarray(at, body + len))
        if (cert.length) out.push(...cert)
        else walk(body, body + len, depth + 1)
      } else if (tag & 0x20) walk(body, body + len, depth + 1)
      at = body + len
    }
  }
  walk(0, bytes.length, 0)
  return out
}

const signed = (child: X509Certificate, issuer: X509Certificate) => {
  try {
    return child.checkIssued(issuer) && child.verify(issuer.publicKey)
  } catch {
    return false
  }
}

/**
 * The intermediates (PEM) that link this host's certificate to a trusted root, fetched from its CA Issuers
 * addresses, or null when there is none: no address, a download that didn't sign it, or a chain that never
 * reaches a root we trust.
 */
export async function completeChain(host: string, port = 443, deps: ChainDeps = defaultDeps): Promise<string[] | null> {
  const roots = deps.roots()
  let cert = await deps.leaf(host, port)
  const chain: X509Certificate[] = []
  for (let depth = 0; cert && depth < MAX_DEPTH; depth++) {
    if (roots.some((r) => signed(cert!, r))) return chain.length ? chain.map((c) => c.toString()) : null
    let next: X509Certificate | null = null
    for (const url of caIssuers(cert)) {
      const found = await deps.download(url).then(certificatesIn, () => [])
      // A CA that signed this certificate and is not its own issuer: a self-signed download is never trusted.
      next = found.find((c) => c.ca && c.subject !== c.issuer && signed(cert!, c)) ?? null
      if (next) break
    }
    if (!next) return null
    chain.push(next)
    cert = next
  }
  return cert && roots.some((r) => signed(cert!, r)) ? chain.map((c) => c.toString()) : null
}

/** The extra CAs for each host whose chain we completed (null: tried, none found), per process. */
const extra = new Map<string, Promise<string[] | null>>()

/**
 * fetch(), with a missing intermediate completed the way a browser does. Redirects are followed one hop at a
 * time once a host needs its chain completed, so each host gets its own intermediates.
 */
export async function fetchCompletingChain(url: string, init: RequestInit, deps: ChainDeps = defaultDeps): Promise<Response> {
  const caFor = (u: URL) => {
    if (u.protocol !== 'https:') return Promise.resolve(null)
    const key = u.host
    let p = extra.get(key)
    if (!p) extra.set(key, (p = completeChain(u.hostname, Number(u.port) || 443, deps).catch(() => null)))
    return p
  }
  // A host already completed goes straight to its chain; any other tries the plain read first.
  if (!extra.has(new URL(url).host)) {
    try {
      return await fetch(url, init)
    } catch (e) {
      if (!missingIssuer(e)) throw e
    }
  }
  let current = new URL(url)
  for (let hop = 0; hop < 10; hop++) {
    const ca = await caFor(current)
    // The extra CAs replace the default store, so the roots we trust go with them: the intermediate alone trusts nothing.
    const res = await fetch(current, { ...init, redirect: 'manual', ...(ca ? { tls: { ca: [...deps.roots().map((r) => r.toString()), ...ca] } } : {}) } as RequestInit)
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location || init.redirect === 'manual') return withUrl(res, current)
    current = new URL(location, current)
  }
  throw new Error('too many redirects')
}

/** A response that reports the URL it was read from, as fetch's own redirect following does. */
function withUrl(res: Response, url: URL): Response {
  if (res.url === url.toString()) return res
  Object.defineProperty(res, 'url', { value: url.toString() })
  return res
}

/** For tests: forget completed chains. */
export const resetChains = () => extra.clear()
