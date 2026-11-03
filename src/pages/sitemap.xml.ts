import type { APIRoute } from 'astro'
import { listings, stats } from '../lib/data'
import { finderPages } from '../lib/finder-pages'
import { absolute } from '../lib/site'

export const GET: APIRoute = () => {
  const urls = [
    { loc: absolute('/'), lastmod: stats.lastChecked },
    { loc: absolute('/about/'), lastmod: null },
    { loc: absolute('/data/'), lastmod: null },
    { loc: absolute('/countries/'), lastmod: null },
    ...Object.values(finderPages)
      .flat()
      .map((pg) => ({ loc: absolute(pg.path), lastmod: pg.listings.map((l) => l.p.checked_at).sort().at(-1) ?? null })),
    ...listings.map(({ p }) => ({ loc: absolute(`/p/${p.id}/`), lastmod: p.checked_at })),
  ]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
