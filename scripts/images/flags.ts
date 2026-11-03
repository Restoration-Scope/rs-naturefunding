// Copies the country flags the "Where" picker shows into public/flags/: bun scripts/images/flags.ts
// The same set Restoration Scope's CountryFlag uses (country-flag-icons, 3×2), served from this site.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { countryRegion } from '../../src/lib/geo'

const from = join(import.meta.dir, '../../node_modules/country-flag-icons/3x2')
const out = join(import.meta.dir, '../../public/flags')
rmSync(out, { recursive: true, force: true })
mkdirSync(out)
for (const code of Object.keys(countryRegion).sort()) copyFileSync(join(from, `${code}.svg`), join(out, `${code}.svg`))
console.log(`${Object.keys(countryRegion).length} flags`)
