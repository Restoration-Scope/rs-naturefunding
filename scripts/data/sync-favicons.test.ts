import { describe, expect, test } from 'bun:test'
import { decodeIco, iconLinks, robotsAllows, robotsRules } from './sync-favicons'

describe('robots.txt', () => {
  const txt = `
User-agent: *
Disallow: /themes/
Allow: /themes/public/
Disallow: /*.pdf$

User-agent: SomeBot
Disallow: /
`
  test('the * group applies; the longest match wins; $ anchors the end', () => {
    const rules = robotsRules(txt)
    expect(robotsAllows(rules, '/')).toBe(true)
    expect(robotsAllows(rules, '/themes/x/favicon.png')).toBe(false)
    expect(robotsAllows(rules, '/themes/public/favicon.png')).toBe(true)
    expect(robotsAllows(rules, '/a.pdf')).toBe(false)
    expect(robotsAllows(rules, '/a.pdf?x=1')).toBe(true)
  })
  test('a group naming us replaces the * group', () => {
    const rules = robotsRules(`${txt}\nUser-agent: naturefunding-marks\nDisallow: /private/\n`)
    expect(robotsAllows(rules, '/themes/x.png')).toBe(true)
    expect(robotsAllows(rules, '/private/x.png')).toBe(false)
  })
  test('empty Disallow allows everything', () => {
    expect(robotsAllows(robotsRules('User-agent: *\nDisallow:\n'), '/favicon.ico')).toBe(true)
  })
})

describe('iconLinks', () => {
  test('reads icon and touch-icon links against <base>, decoding entities, skipping mask icons', async () => {
    const html = `<head><base href="https://cdn.example/site/">
      <link rel="icon" href="fav.png?a=1&#038;b=2" sizes="32x32">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="mask-icon" href="mask.svg">
      <link rel="stylesheet" href="x.css"></head>`
    const links = await iconLinks(html, 'https://example.org/')
    expect(links.map((l) => [l.rel, l.url, l.sizes])).toEqual([
      ['icon', 'https://cdn.example/site/fav.png?a=1&b=2', 32],
      ['apple', 'https://cdn.example/touch.png', null],
    ])
  })
})

describe('decodeIco', () => {
  test('a 2×2 24-bit bitmap icon, with its AND mask for transparency', () => {
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(2, 4)
    header.writeInt32LE(4, 8) // doubled: pixels + mask
    header.writeUInt16LE(1, 12)
    header.writeUInt16LE(24, 14)
    // Bottom-up rows, padded to 4 bytes: bottom row blue, red; top row green, white.
    const pixels = Buffer.from([255, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 255, 0, 0])
    // AND mask, bottom-up, 4 bytes a row: top-right pixel transparent.
    const mask = Buffer.from([0, 0, 0, 0, 0b01000000, 0, 0, 0])
    const image = Buffer.concat([header, pixels, mask])
    const dir = Buffer.alloc(22)
    dir.writeUInt16LE(1, 2)
    dir.writeUInt16LE(1, 4)
    dir[6] = 2
    dir[7] = 2
    dir.writeUInt16LE(24, 12)
    dir.writeUInt32LE(image.length, 14)
    dir.writeUInt32LE(22, 18)
    const out = decodeIco(Buffer.concat([dir, image]))
    if ('png' in out) throw new Error('expected a bitmap')
    expect([out.width, out.height]).toEqual([2, 2])
    expect([...out.rgba]).toEqual([0, 255, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255])
  })
})
