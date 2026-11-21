/**
 * A PDF's text, page by page, with OCR for pages that are images. pdftotext reads the text layer; a page with next
 * to no text that carries an image (a scan) is rendered and read by tesseract in its script's model. OCR text is
 * marked inline (`[OCR of page 3] … [end of OCR]`), so a quote from it checks against the same text in the gather,
 * the refresh and verify-quotes, and it is left out of the page hash (hashText), so whether or which tesseract read
 * a page never looks like a changed page. Without tesseract, an image page stays unread and says it needs OCR.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalise } from '../../src/data/text'

export const OCR_END = '[end of OCR]'
export const ocrStart = (page: number) => `[OCR of page ${page}]`
/** The text without what OCR added: the text layer alone, as the page hash sees it. */
export const withoutOcr = (text: string) => text.replace(/\[OCR of page \d+\][\s\S]*?\[end of OCR\]/g, ' ')

/** Pages OCR reads in one document at most; the rest stay unread and block the stamp. */
export const OCR_PAGE_CAP = 30
/** A page needs this many characters of text OCR is fairly sure of to count as text, not a photo or a blank. */
const MIN_CHARS = 40
/** Words tesseract is fairly sure of (confidence 0–100), and the share of a page's characters they must hold. */
const SURE = 60
const MIN_SURE_SHARE = 0.6

/** A PDF's text, one entry per page (pdftotext separates pages with form feeds), before normalising. */
export function pdfPages(bytes: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'nf-pdf-'))
  try {
    const file = join(dir, 'page.pdf')
    writeFileSync(file, bytes)
    const run = Bun.spawnSync(['pdftotext', '-enc', 'UTF-8', file, '-'])
    if (run.exitCode !== 0) throw new Error(`pdftotext failed: ${run.stderr.toString().trim()}`)
    const pages = run.stdout.toString().split('\f')
    if (pages.length > 1 && !pages.at(-1)!.trim()) pages.pop()
    return pages
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A PDF needs OCR or a browser when it carries too little text for its pages. */
export const lowTextPdf = (pages: string[]) => {
  const chars = pages.reduce((a, p) => a + normalise(p).length, 0)
  return chars < 400 || chars / Math.max(1, pages.length) < 150
}

const thinPages = (pages: string[]) => pages.map((t, i) => ({ i, n: normalise(t).length })).filter((x) => x.n < 200).map((x) => x.i + 1)

/** Pages of a PDF that carry an image and next to no text: a scan inside an otherwise readable PDF. Blank pages have no image. */
export function scannedPages(pages: string[], bytes: Uint8Array): number[] {
  const thin = thinPages(pages)
  if (!thin.length || !bytes.length) return []
  const dir = mkdtempSync(join(tmpdir(), 'nf-img-'))
  try {
    const file = join(dir, 'doc.pdf')
    writeFileSync(file, bytes)
    const run = Bun.spawnSync(['pdfimages', '-list', file])
    // Without pdfimages, a thin page can't be told from a blank one: count it as a scan.
    if (run.exitCode !== 0) return thin
    const big = new Set<number>()
    for (const line of run.stdout.toString().split('\n').slice(2)) {
      const c = line.trim().split(/\s+/)
      if (c.length > 4 && Number(c[3]) * Number(c[4]) >= 250 * 250) big.add(Number(c[0]))
    }
    return thin.filter((n) => big.has(n))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** What OCR read on one page: its text and how many of its characters tesseract was fairly sure of. */
export type OcrPage = { text: string; chars: number; sure: number }
/** Reads one page of a PDF file, in the given script's model or the one script detection picks. */
export type Ocr = { version: string; read: (pdfFile: string, page: number, script: string | null) => OcrPage }

const SCRIPTS: [string, RegExp][] = [
  ['Latin', /\p{Script=Latin}/gu],
  ['Japanese', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ['HanS', /\p{Script=Han}/gu],
  ['Hangul', /\p{Script=Hangul}/gu],
  ['Cyrillic', /\p{Script=Cyrillic}/gu],
  ['Greek', /\p{Script=Greek}/gu],
  ['Arabic', /\p{Script=Arabic}/gu],
  ['Hebrew', /\p{Script=Hebrew}/gu],
  ['Thai', /\p{Script=Thai}/gu],
]

/**
 * The script a document's text layer is written in, or null when it has too little text to tell. It beats script
 * detection on a single page, which reads a German cover page as Cyrillic. Kana anywhere makes Han text Japanese.
 */
export function scriptOf(text: string): string | null {
  const counts = SCRIPTS.map(([name, re]) => [name, text.match(re)?.length ?? 0] as const)
  const total = counts.reduce((a, [, n]) => a + n, 0)
  if (total < 200) return null
  const kana = counts.find(([n]) => n === 'Japanese')![1]
  if (kana >= total * 0.05) return 'Japanese'
  return counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** Tesseract's TSV as text: a line per line, words spaced except between CJK characters. */
export function tsvText(tsv: string): OcrPage {
  const lines: string[] = []
  let key = ''
  let chars = 0
  let sure = 0
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t')
    if (c.length < 12 || c[0] !== '5') continue
    const word = c.slice(11).join('\t').trim()
    if (!word) continue
    const conf = Number(c[10])
    chars += word.length
    if (conf >= SURE) sure += word.length
    const k = `${c[2]}.${c[3]}.${c[4]}`
    if (k !== key) lines.push((key = k, word))
    else {
      const prev = lines[lines.length - 1]!
      lines[lines.length - 1] = CJK.test(prev.at(-1)!) && CJK.test(word[0]!) ? prev + word : `${prev} ${word}`
    }
  }
  return { text: lines.join('\n'), chars, sure }
}

let installed: Ocr | null | undefined
/** Tesseract with pdftoppm, or null when either is missing. Each page is read in the model for its script. */
export function tesseract(): Ocr | null {
  if (installed !== undefined) return installed
  if (!Bun.which('tesseract') || !Bun.which('pdftoppm')) return (installed = null)
  const version = Bun.spawnSync(['tesseract', '--version']).stdout.toString().split('\n')[0]!.trim()
  const langs = new Set(Bun.spawnSync(['tesseract', '--list-langs']).stdout.toString().split('\n').slice(1).map((l) => l.trim()))
  const model = (script: string) => (langs.has(`script/${script}`) ? `script/${script}` : langs.has('script/Latin') ? 'script/Latin' : 'eng')
  return (installed = {
    version,
    read(pdfFile, page, hint) {
      const dir = mkdtempSync(join(tmpdir(), 'nf-ocr-'))
      try {
        const png = join(dir, 'p')
        const render = Bun.spawnSync(['pdftoppm', '-r', '300', '-gray', '-png', '-singlefile', '-f', `${page}`, '-l', `${page}`, pdfFile, png])
        if (render.exitCode !== 0) throw new Error(`pdftoppm failed on page ${page}: ${render.stderr.toString().trim()}`)
        // Without a hint, script detection picks the model; a page too bare to detect is read as Latin.
        const osd = hint ? null : Bun.spawnSync(['tesseract', `${png}.png`, '-', '--psm', '0'])
        const script = hint ?? /Script: (\w+)/.exec(osd!.stdout.toString())?.[1] ?? 'Latin'
        const run = Bun.spawnSync(['tesseract', `${png}.png`, '-', '-l', model(script), '-c', 'preserve_interword_spaces=1', 'tsv'])
        if (run.exitCode !== 0) throw new Error(`tesseract failed on page ${page}: ${run.stderr.toString().trim()}`)
        return tsvText(run.stdout.toString())
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  })
}

export type PdfRead = {
  /** Each page's text layer, with marked OCR text after it where OCR read the page. */
  pages: string[]
  /** Pages OCR read. */
  ocr: number[]
  /** Image pages still unread, and why. */
  unread: { page: number; why: string }[]
}

/**
 * The PDF's pages, with OCR on the image pages: every thin page when the whole PDF is low on text, else the thin
 * pages that carry an image. A page OCR finds almost nothing on is a photo or a blank, not unread text; one it
 * reads but is unsure of stays unread. OCR answers are cached by the file's bytes and the tesseract version.
 */
export function readPdf(bytes: Uint8Array, opts: { ocr?: Ocr | null; cacheDir?: string | null } = {}): PdfRead {
  const pages = pdfPages(bytes)
  const targets = lowTextPdf(pages) ? thinPages(pages) : scannedPages(pages, bytes)
  const out: PdfRead = { pages, ocr: [], unread: [] }
  if (!targets.length) return out
  const ocr = opts.ocr === undefined ? tesseract() : opts.ocr
  if (!ocr) {
    out.unread = targets.map((page) => ({ page, why: 'needs OCR (tesseract is not installed)' }))
    return out
  }
  const cacheDir = opts.cacheDir === undefined ? join(process.cwd(), '.cache', 'ocr') : opts.cacheDir
  const script = scriptOf(pages.join('\n'))
  const id = createHash('sha256').update(bytes).update(`${ocr.version} ${script}`).digest('hex').slice(0, 24)
  const dir = mkdtempSync(join(tmpdir(), 'nf-ocrpdf-'))
  try {
    const file = join(dir, 'doc.pdf')
    writeFileSync(file, bytes)
    for (const [i, page] of targets.entries()) {
      if (i >= OCR_PAGE_CAP) {
        out.unread.push({ page, why: `needs OCR (past the cap of ${OCR_PAGE_CAP} pages a document)` })
        continue
      }
      const cached = cacheDir && join(cacheDir, `${id}-${page}.json`)
      let r: OcrPage
      if (cached && existsSync(cached)) r = JSON.parse(readFileSync(cached, 'utf8'))
      else {
        r = ocr.read(file, page, script)
        if (cached) mkdirSync(cacheDir, { recursive: true }), writeFileSync(cached, JSON.stringify(r))
      }
      if (r.sure < MIN_CHARS) {
        // Mostly unsure words: a photo or drawing when there are few, a page OCR could not read when there are many.
        if (r.chars >= 4 * MIN_CHARS) out.unread.push({ page, why: `OCR could not read it reliably (${Math.round((100 * r.sure) / r.chars)}% of its text read with confidence)` })
        continue
      }
      if (r.sure / r.chars < MIN_SURE_SHARE) {
        out.unread.push({ page, why: `OCR could not read it reliably (${Math.round((100 * r.sure) / r.chars)}% of its text read with confidence)` })
        continue
      }
      pages[page - 1] = `${pages[page - 1]}\n${ocrStart(page)}\n${r.text}\n${OCR_END}\n`
      out.ocr.push(page)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return out
}
