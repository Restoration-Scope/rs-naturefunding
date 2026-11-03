// Cloudflare Worker for relay.naturefunding.org: passes the site's PostHog requests to PostHog US, so ad
// blockers that drop third-party analytics hosts still let the cookieless visit counts through.
// It keeps nothing and logs nothing; the visitor's IP goes on only as X-Forwarded-For, which PostHog
// needs for its daily visitor hash and then discards (the project anonymizes IPs).
const API_HOST = 'us.i.posthog.com'
const ASSET_HOST = 'us-assets.i.posthog.com'

export function upstream(url: URL): URL {
  const assets = url.pathname.startsWith('/static/') || url.pathname.startsWith('/array/')
  return new URL(url.pathname + url.search, `https://${assets ? ASSET_HOST : API_HOST}`)
}

export default {
  async fetch(request: Request): Promise<Response> {
    const headers = new Headers(request.headers)
    headers.delete('cookie')
    const ip = request.headers.get('cf-connecting-ip')
    if (ip) headers.set('x-forwarded-for', ip)
    return fetch(upstream(new URL(request.url)), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    })
  },
}
