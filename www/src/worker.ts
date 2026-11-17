// Cloudflare Worker for www.naturefunding.org: every request gets a 301 to the same path and query on
// https://naturefunding.org, the address the pages declare as canonical. It reads nothing else and logs nothing.
export function apex(url: URL): string {
  return new URL(url.pathname + url.search, 'https://naturefunding.org').toString()
}

export default {
  fetch(request: Request): Response {
    return Response.redirect(apex(new URL(request.url)), 301)
  },
}
