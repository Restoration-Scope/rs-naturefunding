// Makes the forest image for the social card (src/lib/og-card.html renders public/og.png from it) from the
// 1536×768 source: bun scripts/images/header-image.ts <source.jpeg>
// One crop into public/img/header/: the clearing from the edge of the dark trees on the left, full height, with
// the two planters about a fifth in from the left. 1236 px is the source's full width for it, so nothing is upscaled.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const source = process.argv[2]
if (!source) throw new Error('usage: bun scripts/images/header-image.ts <source.jpeg>')
const out = join(import.meta.dir, '../../public/img/header')
mkdirSync(out, { recursive: true })

const crops = {
  hero: { region: { left: 300, top: 0, width: 1236, height: 768 }, widths: [1236] },
}

for (const [name, { region, widths }] of Object.entries(crops)) {
  for (const width of widths) {
    const base = sharp(source).extract(region).resize({ width })
    const file = (ext: string) => join(out, `${name}-${width}.${ext}`)
    const jpeg = await base.clone().jpeg({ quality: 62, mozjpeg: true, progressive: true }).toFile(file('jpg'))
    console.log(`${name}-${width}: ${jpeg.width}×${jpeg.height} jpg ${jpeg.size} B`)
  }
}
