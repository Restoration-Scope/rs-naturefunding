// Makes the home header's image files from the 1536×768 source: bun scripts/images/header-image.ts <source.jpeg>
// One crop, as AVIF, WebP and JPEG at three widths, into public/img/header/.
// - hero: the clearing from the edge of the dark trees on the left, full height, with the two planters about a
//   fifth in from the left. 1236 px is the source's full width for this crop, so nothing is upscaled. The page
//   shows it whole beside the questions on wide screens and as a low band, cropped from the bottom, on phones.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const source = process.argv[2]
if (!source) throw new Error('usage: bun scripts/images/header-image.ts <source.jpeg>')
const out = join(import.meta.dir, '../../public/img/header')
mkdirSync(out, { recursive: true })

const crops = {
  hero: { region: { left: 300, top: 0, width: 1236, height: 768 }, widths: [480, 800, 1236] },
}

for (const [name, { region, widths }] of Object.entries(crops)) {
  for (const width of widths) {
    const base = sharp(source).extract(region).resize({ width })
    const file = (ext: string) => join(out, `${name}-${width}.${ext}`)
    const avif = await base.clone().avif({ quality: 40, effort: 9, chromaSubsampling: '4:2:0' }).toFile(file('avif'))
    const webp = await base.clone().webp({ quality: 42, effort: 6, smartSubsample: true }).toFile(file('webp'))
    const jpeg = await base.clone().jpeg({ quality: 62, mozjpeg: true, progressive: true }).toFile(file('jpg'))
    console.log(`${name}-${width}: ${avif.width}×${avif.height} avif ${avif.size} B, webp ${webp.size} B, jpg ${jpeg.size} B`)
  }
}
