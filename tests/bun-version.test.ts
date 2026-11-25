// CI deploys what passed here, so both must run one Bun: 1.3.6 in CI once refused data 1.4.4 had passed (#1152).
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

test('every workflow runs the Bun the gate runs (else: set bun-version in .github/workflows to it)', () => {
  const dir = join(import.meta.dir, '../.github/workflows')
  const pins = readdirSync(dir).flatMap((f) =>
    [...readFileSync(join(dir, f), 'utf8').matchAll(/bun-version:\s*(\S+)/g)].map((m) => `${f} ${m[1]}`),
  )
  expect(pins.length).toBeGreaterThan(0)
  expect(pins).toEqual(pins.map((p) => `${p.split(' ')[0]} ${Bun.version}`))
})
