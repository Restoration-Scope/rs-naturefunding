import type { APIRoute } from 'astro'
import { listings, stats } from '../lib/data'
import { absolute } from '../lib/site'

export const GET: APIRoute = () => {
  const urls = [
    { loc: absolute('/'), lastmod: stats.lastChecked },
    { loc: absolute('/about/'), lastmod: null },
    ...listings.map(({ p }) => ({ loc: absolute(`/p/${p.id}/`), lastmod: p.checked_at })),
  ]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
