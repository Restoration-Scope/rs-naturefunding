/**
 * The page reader's three gaps: image-only PDF pages (OCR), old Word, OpenDocument, RTF and other office files
 * (conversion), and servers that leave out their intermediate certificate (chain completion). Tests that need
 * tesseract, textutil or soffice, or openssl, are skipped where those aren't installed.
 */
import { describe, expect, test } from 'bun:test'
import { X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { comparable, normalise, quoteOnPage } from '../../src/data/text'
import { hashText } from '../refresh/fetch'
import { gather, type Reader } from '../requirements/gather'
import { converter, legacyKind, officeText } from './convert'
import { ocrStart, OCR_END, readPdf, scriptOf, tesseract, tsvText, withoutOcr, type Ocr } from './pdf'
import { caIssuers, certificatesIn, completeChain, fetchCompletingChain, missingIssuer, resetChains, type ChainDeps } from './tls-chain'

const RULE = 'Applicants must be registered charities with two years of accounts.'

/** A PDF of pages, each either text (a line repeated) or an image (gray pixels, width by height). */
function pdfOf(pages: ({ text: string } | { gray: Uint8Array; width: number; height: number })[]): Uint8Array {
  const objs: (string | Uint8Array)[] = ['<< /Type /Catalog /Pages 2 0 R >>', '']
  const kids: number[] = []
  const font = 3
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (const p of pages) {
    const page = objs.length + 1
    kids.push(page)
    if ('text' in p) {
      const content = `BT /F1 11 Tf 40 740 Td ${Array(14).fill(`(${p.text}) Tj 0 -16 Td`).join(' ')} ET`
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${page + 1} 0 R >>`)
      objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    } else {
      const content = 'q 612 0 0 792 0 0 cm /Im1 Do Q'
      const data = deflateSync(p.gray)
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`)
      objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
      const head = new TextEncoder().encode(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`)
      objs.push(new Uint8Array([...head, ...data, ...new TextEncoder().encode('\nendstream')]))
    }
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const parts: Uint8Array[] = [new TextEncoder().encode('%PDF-1.4\n')]
  let length = parts[0]!.length
  const at: number[] = []
  objs.forEach((o, i) => {
    at.push(length)
    const body = typeof o === 'string' ? new TextEncoder().encode(o) : o
    const chunk = new Uint8Array([...new TextEncoder().encode(`${i + 1} 0 obj\n`), ...body, ...new TextEncoder().encode('\nendobj\n')])
    parts.push(chunk)
    length += chunk.length
  })
  parts.push(new TextEncoder().encode(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return new Uint8Array(parts.flatMap((p) => [...p]))
}

const blank = { gray: new Uint8Array(400 * 400).fill(200), width: 400, height: 400 }
const textPage = { text: `${RULE} Test Nature Grants fund river restoration.` }
const fakeOcr = (page: { text: string; chars?: number; sure?: number }): Ocr & { calls: number[] } => {
  const calls: number[] = []
  return { version: 'fake 1', calls, read: (_f, n) => (calls.push(n), { text: page.text, chars: page.chars ?? page.text.length, sure: page.sure ?? page.text.length }) }
}

describe('OCR for image-only PDF pages', () => {
  test('a scanned page is read by OCR, marked, and its text checks quotes', () => {
    const pdf = pdfOf([textPage, blank])
    const ocr = fakeOcr({ text: 'Projects must start within 6 months of the award.' })
    const r = readPdf(pdf, { ocr, cacheDir: null })
    expect(ocr.calls).toEqual([2])
    expect(r.ocr).toEqual([2])
    expect(r.unread).toEqual([])
    const text = normalise(r.pages.join('\n'))
    expect(text).toContain(`${ocrStart(2)} Projects must start within 6 months of the award. ${OCR_END}`)
    expect(quoteOnPage(comparable(text), 'Projects must start within 6 months of the award.')).toBe(true)
  })

  test('OCR text never changes the page hash: the text layer alone is hashed', () => {
    const pdf = pdfOf([textPage, blank])
    const withOcr = normalise(readPdf(pdf, { ocr: fakeOcr({ text: 'Projects must start within 6 months of the award.' }), cacheDir: null }).pages.join('\n'))
    const without = normalise(readPdf(pdf, { ocr: null, cacheDir: null }).pages.join('\n'))
    expect(withOcr).not.toBe(without)
    expect(hashText(withOcr)).toBe(hashText(without))
    expect(withoutOcr(withOcr)).not.toContain('Projects must start')
  })

  test('without tesseract an image page stays unread and says it needs OCR', () => {
    const r = readPdf(pdfOf([textPage, blank]), { ocr: null, cacheDir: null })
    expect(r.unread).toEqual([{ page: 2, why: 'needs OCR (tesseract is not installed)' }])
  })

  test('a photo (a few unsure words) is no text; a page of unsure text stays unread', () => {
    const photo = readPdf(pdfOf([textPage, blank]), { ocr: fakeOcr({ text: 'ﺱ 2 Gop', sure: 0 }), cacheDir: null })
    expect(photo).toMatchObject({ ocr: [], unread: [] })
    const smudged = readPdf(pdfOf([textPage, blank]), { ocr: fakeOcr({ text: 'x'.repeat(400), sure: 100 }), cacheDir: null })
    expect(smudged.ocr).toEqual([])
    expect(smudged.unread[0]!.why).toMatch(/OCR could not read it reliably \(25%/)
    // A short title OCR is sure of is the page's text, not a picture.
    const title = readPdf(pdfOf([textPage, blank]), { ocr: fakeOcr({ text: 'Important dates' }), cacheDir: null })
    expect(title.ocr).toEqual([2])
  })

  test('OCR answers are cached by the file and the tesseract version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nf-ocr-test-'))
    try {
      const pdf = pdfOf([textPage, blank])
      const ocr = fakeOcr({ text: 'Projects must start within 6 months of the award.' })
      readPdf(pdf, { ocr, cacheDir: dir })
      readPdf(pdf, { ocr, cacheDir: dir })
      expect(ocr.calls).toEqual([2])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the text layer names the script; kana makes Han text Japanese', () => {
    expect(scriptOf('Antragsteller müssen gemeinnützig sein. '.repeat(10))).toBe('Latin')
    expect(scriptOf('助成金の申請は、団体の代表者が行ってください。'.repeat(20))).toBe('Japanese')
    expect(scriptOf('short')).toBeNull()
  })

  test("tesseract's TSV becomes lines, with confidence counted per character", () => {
    const row = (line: number, word: number, conf: number, text: string) => `5\t1\t1\t1\t${line}\t${word}\t0\t0\t1\t1\t${conf}\t${text}`
    const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext', '1\t1\t0\t0\t0\t0\t0\t0\t1\t1\t-1\t', row(1, 1, 96, 'Apply'), row(1, 2, 40, 'by'), row(2, 1, 90, '募集'), row(2, 2, 90, '要項'), row(2, 3, 90, '、'), row(3, 1, 90, '신청'), row(3, 2, 90, '마감')].join('\n')
    expect(tsvText(tsv)).toEqual({ text: 'Apply by\n募集要項、\n신청 마감', chars: 32, sure: 30 })
  })

  const tools = !!tesseract()
  test.skipIf(!tools)('tesseract reads a real scan of the rule', () => {
    // Render a text page to pixels, then make a PDF whose only page is that picture.
    const dir = mkdtempSync(join(tmpdir(), 'nf-scan-test-'))
    try {
      writeFileSync(join(dir, 'text.pdf'), pdfOf([{ text: RULE }]))
      const run = Bun.spawnSync(['pdftoppm', '-r', '100', '-gray', '-singlefile', join(dir, 'text.pdf'), join(dir, 'img')])
      expect(run.exitCode).toBe(0)
      const pgm = readFileSync(join(dir, 'img.pgm'))
      const [, w, h] = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(new TextDecoder('latin1').decode(pgm.subarray(0, 40)))!
      const header = /^P5\s+\d+\s+\d+\s+255\s/.exec(new TextDecoder('latin1').decode(pgm.subarray(0, 40)))![0].length
      const scan = pdfOf([{ gray: new Uint8Array(pgm.subarray(header)), width: Number(w), height: Number(h) }])
      const r = readPdf(scan, { cacheDir: null })
      expect(r.ocr).toEqual([1])
      expect(comparable(r.pages.join(' '))).toContain('registered charities')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test('the gather reads an OCR page instead of reporting it; an unsure page still blocks the stamp', async () => {
    const programme = { id: 'test-grants', name: 'Test Nature Grants', url: 'https://test.example.org/guide.pdf', funder: { name: 'Test Trust' }, administered_by: null, calls: [], evidence: {} } as never
    const pdf = pdfOf([textPage, textPage, blank])
    const read: Reader = async () => ({ ok: true, finalUrl: 'https://test.example.org/guide.pdf', pdf: true, html: '', bytes: pdf })
    const readOk = await gather(programme, { read, sources: [], ocr: fakeOcr({ text: 'Projects must start within 6 months of the award.' }) })
    expect(readOk.complete).toBe(true)
    expect(readOk.docs[0]!.text).toContain('[OCR of page 3] Projects must start within 6 months of the award. [end of OCR]')
    const unsure = await gather(programme, { read, sources: [], ocr: fakeOcr({ text: 'x'.repeat(400), sure: 100 }) })
    expect(unsure.complete).toBe(false)
    expect(unsure.reasons).toEqual(['https://test.example.org/guide.pdf: page 3 is an image: OCR could not read it reliably (25% of its text read with confidence)'])
    const none = await gather(programme, { read, sources: [], ocr: null })
    expect(none.reasons).toEqual(['https://test.example.org/guide.pdf: page 3 is an image: needs OCR (tesseract is not installed)'])
  })

  test('a page OCR fails on stays unread; the rest of the document is kept', () => {
    const broken: Ocr = { version: 'fake', read: () => { throw new Error('tesseract failed on page 2: killed') } }
    const r = readPdf(pdfOf([textPage, blank]), { ocr: broken, cacheDir: null })
    expect(r.unread).toEqual([{ page: 2, why: 'needs OCR (tesseract failed on page 2: killed)' }])
    expect(normalise(r.pages[0]!)).toContain(RULE)
  })
})

describe('old Word, OpenDocument, RTF and other office files', () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/office/${name}`))

  test('a file is known by its bytes, not its link', () => {
    expect(legacyKind(fixture('rules.doc'))).toBe('doc')
    expect(legacyKind(fixture('rules.odt'))).toBe('odt')
    expect(legacyKind(fixture('rules.rtf'))).toBe('rtf')
    expect(legacyKind(fixture('budget.xlsx'))).toBeNull()
    // An OLE file without a WordDocument stream is a spreadsheet or a deck: never sent to the Word converter.
    const xls = new Uint8Array(512)
    xls.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(legacyKind(xls)).toBeNull()
    expect(() => officeText(xls)).toThrow('an old Excel or PowerPoint file (.xls, .ppt): needs conversion')
    expect(officeText(new TextEncoder().encode('<html><body>hi</body></html>'))).toBeNull()
  })

  const convert = converter()
  for (const name of ['rules.doc', 'rules.odt', 'rules.rtf']) {
    test.skipIf(!convert)(`${name} converts to its text with ${convert?.name ?? 'no converter'}`, () => {
      const text = normalise(officeText(fixture(name))!.text)
      expect(text).toContain(RULE)
      expect(text).toContain('Apply by 1 March 2027.')
    })
  }

  test('without a converter, an old Word file says it needs conversion', () => {
    expect(() => officeText(fixture('rules.doc'), null)).toThrow('needs conversion')
  })

  test('a spreadsheet reads row by row, shared and inline strings and values, without phonetic guides', () => {
    expect(officeText(fixture('budget.xlsx'))).toEqual({ kind: 'xlsx', text: 'Item Match required\nCap & limit 50000 EUR' })
  })

  test('a deck reads slide by slide in number order, with its notes', () => {
    expect(officeText(fixture('slides.pptx'))).toEqual({ kind: 'pptx', text: 'Webinar\nHow to apply\nSubmit in Easygrants by 1 March\nMatch must be 1:1\nQuestions?' })
  })
})

describe('completing a certificate chain the server left out', () => {
  const openssl = !!Bun.which('openssl')
  const ssl = (dir: string, args: string[]) => {
    const run = Bun.spawnSync(['openssl', ...args], { cwd: dir })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
    return run.stdout
  }
  /** A root, an intermediate it signed, and a leaf the intermediate signed whose AIA names the intermediate. */
  function pki() {
    const dir = mkdtempSync(join(tmpdir(), 'nf-pki-'))
    const key = (name: string) => ssl(dir, ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', `${name}.key`])
    for (const n of ['root', 'int', 'leaf', 'rogue']) key(n)
    writeFileSync(join(dir, 'ca.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n')
    writeFileSync(join(dir, 'leaf.ext'), 'basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nauthorityInfoAccess=caIssuers;URI:http://aia.test/int.crt\n')
    ssl(dir, ['req', '-x509', '-new', '-key', 'root.key', '-subj', '/CN=Test Root', '-days', '2', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', 'root.pem'])
    ssl(dir, ['req', '-new', '-key', 'int.key', '-subj', '/CN=Test Intermediate', '-out', 'int.csr'])
    ssl(dir, ['x509', '-req', '-in', 'int.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '2', '-extfile', 'ca.ext', '-out', 'int.pem'])
    ssl(dir, ['req', '-new', '-key', 'leaf.key', '-subj', '/CN=localhost', '-out', 'leaf.csr'])
    ssl(dir, ['x509', '-req', '-in', 'leaf.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-CAcreateserial', '-days', '2', '-extfile', 'leaf.ext', '-out', 'leaf.pem'])
    // A self-signed CA made with the intermediate's own key and name: it "signed" the leaf, but trusts nothing.
    ssl(dir, ['req', '-x509', '-new', '-key', 'int.key', '-subj', '/CN=Test Intermediate', '-days', '2', '-addext', 'basicConstraints=critical,CA:TRUE', '-out', 'selfsigned.pem'])
    ssl(dir, ['req', '-x509', '-new', '-key', 'rogue.key', '-subj', '/CN=Rogue CA', '-days', '2', '-addext', 'basicConstraints=critical,CA:TRUE', '-out', 'rogue.pem'])
    const p7c = ssl(dir, ['crl2pkcs7', '-nocrl', '-certfile', 'int.pem', '-outform', 'DER'])
    const read = (f: string) => readFileSync(join(dir, f), 'utf8')
    const out = { root: read('root.pem'), int: read('int.pem'), leaf: read('leaf.pem'), leafKey: read('leaf.key'), selfsigned: read('selfsigned.pem'), rogue: read('rogue.pem'), p7c: new Uint8Array(p7c) }
    rmSync(dir, { recursive: true, force: true })
    return out
  }
  const certs = openssl ? pki() : null
  const deps = (download: Uint8Array | string): ChainDeps => ({
    leaf: async () => new X509Certificate(certs!.leaf),
    download: async (url) => {
      expect(url).toBe('http://aia.test/int.crt')
      return typeof download === 'string' ? new TextEncoder().encode(download) : download
    },
    roots: () => [new X509Certificate(certs!.root)],
  })

  test.skipIf(!openssl)('the intermediate named in the leaf (PEM, DER or a PKCS#7 bundle) completes the chain', async () => {
    expect(caIssuers(new X509Certificate(certs!.leaf))).toEqual(['http://aia.test/int.crt'])
    expect(certificatesIn(certs!.p7c).map((c) => c.subject)).toEqual(['CN=Test Intermediate'])
    for (const download of [certs!.int, new Uint8Array(new X509Certificate(certs!.int).raw), certs!.p7c]) {
      expect(await completeChain('localhost', 443, deps(download))).toEqual([new X509Certificate(certs!.int).toString()])
    }
  })

  test.skipIf(!openssl)('a self-signed or unrelated download, or a chain to no trusted root, is refused', async () => {
    expect(await completeChain('localhost', 443, deps(certs!.selfsigned))).toBeNull()
    expect(await completeChain('localhost', 443, deps(certs!.rogue))).toBeNull()
    expect(await completeChain('localhost', 443, deps(certs!.root))).toBeNull()
    expect(await completeChain('localhost', 443, { ...deps(certs!.int), roots: () => [new X509Certificate(certs!.rogue)] })).toBeNull()
  })

  test.skipIf(!openssl)('a server that sends only its own certificate is read, and still verified', async () => {
    resetChains()
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', tls: { cert: certs!.leaf, key: certs!.leafKey }, fetch: () => new Response('Test Nature Grants rules') })
    try {
      const url = `https://localhost:${server.port}/rules`
      const plain = await fetch(url).catch((e) => e)
      expect(missingIssuer(plain) || plain instanceof Error).toBe(true)
      const real = { ...deps(certs!.int), leaf: (await import('./tls-chain')).defaultDeps.leaf }
      const res = await fetchCompletingChain(url, { redirect: 'follow' }, real)
      expect(await res.text()).toBe('Test Nature Grants rules')
      expect(res.url).toBe(url)
      // With the wrong download the chain stays broken and the read fails, as it should.
      resetChains()
      await expect(fetchCompletingChain(url, { redirect: 'follow' }, { ...real, download: async () => new TextEncoder().encode(certs!.rogue) })).rejects.toThrow()
    } finally {
      server.stop(true)
    }
  })
})
