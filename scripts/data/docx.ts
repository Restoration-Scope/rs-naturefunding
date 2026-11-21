/**
 * Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) text, read straight from the zip, so a funder's guidelines,
 * forms and budget templates published that way are checked like a PDF. Read through convert.ts's officeText,
 * shared by page-text (verify-quotes), the refresh's readPage and the requirements gather.
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

/** Every file name in a zip, in directory order. */
export function zipNames(bytes: Uint8Array): string[] {
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (u32(bytes, at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) return []
  const names: string[] = []
  let at = u32(bytes, end + 16)
  for (let i = 0; i < u16(bytes, end + 10) && u32(bytes, at) === 0x02014b50; i++) {
    const nameLen = u16(bytes, at + 28)
    names.push(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen)))
    at += 46 + nameLen + u16(bytes, at + 30) + u16(bytes, at + 32)
  }
  return names
}

const xmlText = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (m, hex, dec, named) =>
      hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : (ENTITIES[named] ?? m),
    )

/** The numbered parts of a zip under a folder ("ppt/slides/slide2.xml"), in number order. */
const numbered = (bytes: Uint8Array, re: RegExp) =>
  zipNames(bytes)
    .filter((n) => re.test(n))
    .sort((a, b) => Number(re.exec(a)![1]) - Number(re.exec(b)![1]))

/** A spreadsheet (.xlsx)'s cells: a line per row, sheet by sheet; shared and inline strings and plain values. */
export function xlsxText(bytes: Uint8Array): string {
  const shared = zipEntry(bytes, 'xl/sharedStrings.xml')
  const strings = shared ? [...new TextDecoder().decode(shared).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''))) : []
  const out: string[] = []
  for (const name of numbered(bytes, /^xl\/worksheets\/sheet(\d+)\.xml$/)) {
    const xml = new TextDecoder().decode(zipEntry(bytes, name)!)
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, inner = '']) => {
        if (/\bt="s"/.test(attrs!)) return strings[Number(/<v>(\d+)<\/v>/.exec(inner)?.[1] ?? -1)] ?? ''
        if (/\bt="inlineStr"/.test(attrs!)) return xmlText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '')
        return xmlText(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '')
      })
      const line = cells.filter((c) => c.trim()).join(' ')
      if (line) out.push(line)
    }
  }
  return out.join('\n')
}

/** A presentation (.pptx)'s text: slide by slide, a line per paragraph, then each slide's notes. */
export function pptxText(bytes: Uint8Array): string {
  const paras = (xml: string) => [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1]!.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => xmlText(t[1]!)).join('')).filter((l) => l.trim())
  const notes = new Map(numbered(bytes, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/).map((n) => [Number(/(\d+)\.xml$/.exec(n)![1]), n]))
  return numbered(bytes, /^ppt\/slides\/slide(\d+)\.xml$/)
    .map((name) => {
      const n = Number(/(\d+)\.xml$/.exec(name)![1])
      const note = notes.get(n)
      return [...paras(new TextDecoder().decode(zipEntry(bytes, name)!)), ...(note ? paras(new TextDecoder().decode(zipEntry(bytes, note)!)) : [])].join('\n')
    })
    .join('\n')
}
