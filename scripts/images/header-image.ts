// Makes the home header's image files from the 1536×768 source: bun scripts/images/header-image.ts <source.jpeg>
// Two crops, each as AVIF, WebP and JPEG at two widths, into public/img/header/.
// - wide: the clearing right of the dark trees (figures near its left edge), for the window beside the text
//   on tablets and wider. 1096 px is the source's full width for this crop, so nothing is upscaled.
// - strip: a low band around the two planters and the seedling row, under the text on phones.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const source = process.argv[2]
if (!source) throw new Error('usage: bun scripts/images/header-image.ts <source.jpeg>')
const out = join(import.meta.dir, '../../public/img/header')
mkdirSync(out, { recursive: true })

const crops = {
  wide: { region: { left: 440, top: 300, width: 1096, height: 468 }, widths: [640, 1096] },
  strip: { region: { left: 440, top: 520, width: 1096, height: 248 }, widths: [480, 768] },
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
