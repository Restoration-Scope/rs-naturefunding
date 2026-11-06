// Small icons for the weekly email, served from this site: bun scripts/images/email-icons.ts
// - public/icons/regions/<region>: the region's land, drawn from its member countries (src/lib/geo.ts).
// - public/icons/types/<type>: the lucide icon the finder shows for each project type (Finder.astro).
// - public/icons/marks/<domain>.png: each funder's mark (public/marks/, from sync-favicons) as a 32×32 PNG.
// Each region and type is an SVG plus a 48×48 PNG, since Gmail and Outlook don't show SVG images
// (and Outlook doesn't show WebP, the marks' format). Run again after sync-favicons.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { geoArea, geoAzimuthalEqualArea, geoCentroid, geoPath } from 'd3-geo'
import countries from 'i18n-iso-countries'
import { Bird, Building2, Droplets, Microscope, Trees, Users, Waves, Wheat } from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { feature } from 'topojson-client'
import world from 'world-atlas/countries-110m.json' with { type: 'json' }
import { countryRegion, type Region } from '../../src/lib/geo'
import { marks } from '../../src/lib/marks'

const BRAND = '#3a7e49' // --brand in src/styles/global.css
const SIZE = 24
const out = join(import.meta.dir, '../../public/icons')
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'regions'), { recursive: true })
mkdirSync(join(out, 'types'), { recursive: true })
mkdirSync(join(out, 'marks'), { recursive: true })

const write = async (file: string, svg: string) => {
  writeFileSync(`${file}.svg`, svg)
  await sharp(Buffer.from(svg), { density: 72 * 6 }).resize(48, 48).png({ compressionLevel: 9 }).toFile(`${file}.png`)
}

// Regions. Europe leaves out Greenland and is cut at the Urals, or Russia's east would fill the icon.
const all = (feature(world as any, (world as any).objects.countries) as any).features as any[]
const crop: Partial<Record<Region, (lon: number, lat: number) => boolean>> = {
  europe: (lon, lat) => lon > -26 && lon < 62 && lat > 34,
}
for (const region of [...new Set(Object.values(countryRegion))] as Region[]) {
  const keep = crop[region] ?? (() => true)
  // Every polygon of the region's countries, minus the ones outside the crop.
  const polys = all
    .filter((f) => countries.numericToAlpha2(f.id) !== 'GL' && countryRegion[countries.numericToAlpha2(f.id) ?? ''] === region)
    .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates))
    .map((coordinates: number[][][]) => ({ type: 'Polygon', coordinates }) as any)
    .filter((p) => keep(...(geoCentroid(p) as [number, number])))
  // Fit to the main land, so far islands (Pacific atolls, the Azores) don't shrink the icon to a dot.
  const largest = Math.max(...polys.map((p) => geoArea(p)))
  const main = { type: 'GeometryCollection', geometries: polys.filter((p) => geoArea(p) >= largest * 0.03) } as any
  const shown = { type: 'GeometryCollection', geometries: polys.filter((p) => geoArea(p) >= largest * 0.002) } as any
  const [lon, lat] = geoCentroid(main)
  const projection = geoAzimuthalEqualArea().rotate([-lon, -lat]).fitExtent([[1, 1], [SIZE - 1, SIZE - 1]], main).clipExtent([[0, 0], [SIZE, SIZE]])
  const d = geoPath(projection).digits(2)(shown)
  await write(join(out, 'regions', region), `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><path fill="${BRAND}" d="${d}"/></svg>`)
}

// Project types, keyed as projectTypes in src/lib/labels.ts.
const typeIcons = { forests: Trees, coasts: Waves, wetlands: Droplets, grasslands: Wheat, wildlife: Bird, communities: Users, cities: Building2, research: Microscope }
for (const [key, Icon] of Object.entries(typeIcons)) {
  const svg = renderToStaticMarkup(createElement(Icon, { size: SIZE, color: BRAND, strokeWidth: 2.5 }))
  await write(join(out, 'types', key), svg)
}
// Funder marks, at twice the 16 px the email shows them.
for (const m of Object.values(marks)) {
  if (!m.file) continue
  await sharp(join(import.meta.dir, '../../public', m.file)).resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(join(out, 'marks', `${m.domain}.png`))
}
console.log('email icons written to public/icons/')
