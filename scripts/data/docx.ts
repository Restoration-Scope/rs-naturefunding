/**
 * A Word (.docx) file's text, read straight from its zip, so a funder's guidelines published as Word are
 * checked like a PDF. Shared by page-text (verify-quotes), the refresh's readPage and the requirements gather:
 * a quote copied from one reads the same in the others.
 */
import { inflateRawSync } from 'node:zlib'

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8)
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0

/** One file inside a zip, or null when the zip has no such entry. Stored and deflated entries; no zip64. */
export function zipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  // The end-of-central-directory record sits in the last 64 KB (its comment can be that long).
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (u32(bytes, at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) return null
  const count = u16(bytes, end + 10)
  let at = u32(bytes, end + 16)
  for (let i = 0; i < count && u32(bytes, at) === 0x02014b50; i++) {
    const method = u16(bytes, at + 10)
    const size = u32(bytes, at + 20)
    const nameLen = u16(bytes, at + 28)
    const local = u32(bytes, at + 42)
    const entry = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen))
    at += 46 + nameLen + u16(bytes, at + 30) + u16(bytes, at + 32)
    if (entry !== name) continue
    const data = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28)
    const raw = bytes.subarray(data, data + size)
    if (method === 0) return raw
    if (method === 8) return new Uint8Array(inflateRawSync(raw))
    throw new Error(`zip entry ${name} uses compression method ${method}`)
  }
  return null
}

/** A zip that holds a Word document body. */
export const isDocx = (bytes: Uint8Array) => u32(bytes, 0) === 0x04034b50 && zipEntry(bytes, 'word/document.xml') !== null

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The body's text: one line per paragraph, cells and tabs as spaces. Field codes, deleted text, drawing positions
 * and the fallback copy of each text box are left out, so nothing reads twice or as stray numbers. */
export function docxText(bytes: Uint8Array): string {
  const body = zipEntry(bytes, 'word/document.xml')
  if (!body) throw new Error('not a Word document: no word/document.xml')
  return new TextDecoder()
    .decode(body)
    .replace(/<(w:instrText|w:delText|mc:Fallback|wp:posOffset|wp:align)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<w:(?:tab|br|cr)\b[^>]*\/>/g, (t) => (t.startsWith('<w:tab') ? ' ' : '\n'))
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (m, hex, dec, named) =>
      hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : (ENTITIES[named] ?? m),
    )
}
