/**
 * Office files a funder links as plain text. Word, Excel and PowerPoint (.docx, .xlsx, .pptx) are read straight from
 * their zip; old Word (.doc), OpenDocument text (.odt) and RTF are converted with macOS `textutil`, else LibreOffice
 * (`soffice --headless`) when installed. The file's own bytes decide what it is, never its link: an OLE file may be a
 * spreadsheet and a zip anything. Shared by page-text (verify-quotes), readPage and the gather, so all read alike.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docxText, isDocx, pptxText, xlsxText, zipEntry } from './docx'

export type Legacy = 'doc' | 'odt' | 'rtf'

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** What kind of convertible file these bytes are, or null. An OLE file is a Word file only if it holds a WordDocument stream. */
export function legacyKind(bytes: Uint8Array): Legacy | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8))
  if (head.startsWith('{\\rtf')) return 'rtf'
  if (OLE.every((b, i) => bytes[i] === b)) {
    // The stream name sits in the directory as UTF-16: "WordDocument".
    const name = new TextEncoder().encode('WordDocument').reduce<number[]>((a, c) => (a.push(c, 0), a), [])
    return indexOf(bytes, name) >= 0 ? 'doc' : null
  }
  if (head.startsWith('PK\x03\x04')) {
    try {
      const mime = zipEntry(bytes, 'mimetype')
      return mime && new TextDecoder().decode(mime).trim() === 'application/vnd.oasis.opendocument.text' ? 'odt' : null
    } catch {
      return null
    }
  }
  return null
}

function indexOf(hay: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

export type Converter = { name: string; convert: (file: string, kind: Legacy, dir: string) => string }

/** textutil on macOS, else soffice with a throwaway profile, else null. */
export function converter(): Converter | null {
  if (Bun.which('textutil')) {
    return {
      name: 'textutil',
      convert(file, kind) {
        const run = Bun.spawnSync(['textutil', '-format', kind, '-convert', 'txt', '-encoding', 'UTF-8', '-stdout', file])
        if (run.exitCode !== 0) throw new Error(`textutil could not convert this ${kind} file: ${run.stderr.toString().trim()}`)
        return run.stdout.toString()
      },
    }
  }
  const soffice = Bun.which('soffice') ?? Bun.which('libreoffice')
  if (!soffice) return null
  return {
    name: 'soffice',
    convert(file, kind, dir) {
      const out = join(dir, 'out')
      const run = Bun.spawnSync([soffice, `-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', out, file], { timeout: 120_000 })
      const txt = existsSync(out) ? readdirSync(out).find((f) => f.endsWith('.txt')) : undefined
      if (run.exitCode !== 0 || !txt) throw new Error(`soffice could not convert this ${kind} file: ${run.stderr.toString().trim()}`)
      return readFileSync(join(out, txt), 'utf8')
    },
  }
}

/** The file's text, before normalising. Throws when no converter is installed or it fails. */
export function legacyText(bytes: Uint8Array, kind: Legacy, use: Converter | null = converter()): string {
  if (!use) throw new Error(`an old Word (.doc), OpenDocument or RTF file: needs conversion (neither textutil nor soffice is installed)`)
  const dir = mkdtempSync(join(tmpdir(), 'nf-doc-'))
  try {
    const file = join(dir, `file.${kind}`)
    writeFileSync(file, bytes)
    return use.convert(file, kind, dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export type OfficeKind = 'docx' | 'xlsx' | 'pptx' | Legacy

/**
 * An office file's text, before normalising, or null when the bytes are no office file or zip. Throws, with the
 * reason, for one that can't be read: an old Excel or PowerPoint file, a zip of something else, a failed conversion.
 */
export function officeText(bytes: Uint8Array, use?: Converter | null): { kind: OfficeKind; text: string } | null {
  if (isDocx(bytes)) return { kind: 'docx', text: docxText(bytes) }
  const kind = legacyKind(bytes)
  if (kind) return { kind, text: legacyText(bytes, kind, use === undefined ? converter() : use) }
  if (OLE.every((b, i) => bytes[i] === b)) throw new Error('an old Excel or PowerPoint file (.xls, .ppt): needs conversion')
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 4)) === 'PK\x03\x04') {
    if (zipEntry(bytes, 'xl/workbook.xml')) return { kind: 'xlsx', text: xlsxText(bytes) }
    if (zipEntry(bytes, 'ppt/presentation.xml')) return { kind: 'pptx', text: pptxText(bytes) }
    throw new Error('a zip file, not a document we can read')
  }
  return null
}
