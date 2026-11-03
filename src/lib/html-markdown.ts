// Turns a built prose page (its title band and <main>) into Markdown, so the page's twin is made from the page
// itself and can't drift from it. Covers what the prose pages use: headings, paragraphs, lists, definition lists,
// quotes, code, tables and links; navigation, scripts and icons are dropped.
import { parseHTML } from 'linkedom'

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'UL',
])
const DROP = 'script, style, svg, nav, [data-toc], [aria-hidden="true"], [hidden], template'

type El = Element

const isBlock = (n: Node) => n.nodeType === 1 && BLOCK.has((n as El).tagName)
const tidy = (s: string) => s.replace(/[ \t\n\r]+/g, ' ')

function inline(node: Node, base: string): string {
  if (node.nodeType === 3) return tidy(node.textContent ?? '')
  if (node.nodeType !== 1) return ''
  const el = node as El
  const inner = () => [...el.childNodes].map((c) => inline(c, base)).join('')
  switch (el.tagName) {
    case 'A': {
      const text = inner().trim()
      const href = el.getAttribute('href')
      if (!href || !text) return text
      return `[${text}](${new URL(href, base).toString()})`
    }
    case 'STRONG':
    case 'B': {
      const t = inner().trim()
      return t ? `**${t}**` : ''
    }
    case 'EM':
    case 'I': {
      const t = inner().trim()
      return t ? `*${t}*` : ''
    }
    case 'CODE':
      return `\`${el.textContent ?? ''}\``
    case 'BR':
      return '\n'
    default:
      return inner()
  }
}

const para = (s: string) => s.replace(/ *\n */g, '\n').replace(/ {2,}/g, ' ').trim()

/** Block-level Markdown for the children of an element: inline runs become paragraphs. */
function blocks(el: El, base: string): string[] {
  const out: string[] = []
  let run = ''
  const flush = () => {
    const p = para(run)
    if (p) out.push(p)
    run = ''
  }
  for (const c of el.childNodes) {
    if (isBlock(c)) {
      flush()
      out.push(...block(c as El, base))
    } else run += inline(c, base)
  }
  flush()
  return out
}

function list(el: El, base: string, ordered: boolean): string {
  return [...el.children]
    .filter((li) => li.tagName === 'LI')
    .map((li, i) => {
      const body = blocks(li, base).join('\n\n')
      const marker = ordered ? `${i + 1}. ` : '- '
      return marker + body.replace(/\n/g, `\n${' '.repeat(marker.length)}`)
    })
    .join('\n')
}

function block(el: El, base: string): string[] {
  const tag = el.tagName
  if (/^H[1-6]$/.test(tag)) return [`${'#'.repeat(Number(tag[1]))} ${para(inline(el, base))}`]
  switch (tag) {
    case 'P':
    case 'FIGCAPTION':
    case 'SUMMARY': {
      const p = para(inline(el, base))
      return p ? [tag === 'SUMMARY' ? `**${p}**` : p] : []
    }
    case 'UL':
      return [list(el, base, false)]
    case 'OL':
      return [list(el, base, true)]
    case 'BLOCKQUOTE':
      return [blocks(el, base).join('\n\n').replace(/^/gm, '> ')]
    case 'PRE':
      return [`\`\`\`\n${(el.textContent ?? '').replace(/\n$/, '')}\n\`\`\``]
    case 'HR':
      return ['---']
    case 'DL': {
      const items = [...el.querySelectorAll('dt')].map((dt) => {
        const dd = dt.nextElementSibling?.tagName === 'DD' ? dt.nextElementSibling : null
        const term = para(inline(dt, base))
        const body = dd ? blocks(dd, base) : []
        if (body.length <= 1) return `- **${term}**${body[0] ? `: ${body[0]}` : ''}`
        return `- **${term}**\n\n${body.map((b) => b.replace(/^/gm, '  ')).join('\n\n')}`
      })
      return [items.join('\n')]
    }
    case 'TABLE': {
      const rows = [...el.querySelectorAll('tr')].map((tr) =>
        [...tr.children].map((c) => para(inline(c, base)).replace(/\|/g, '\\|').replace(/\n/g, ' ')),
      )
      if (!rows.length) return []
      const width = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
      return [[line(rows[0]!), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n')]
    }
    default:
      return blocks(el, base)
  }
}

/** The title band (the <h1> and what sits beside it in the header) and <main>, as Markdown. */
export function pageMarkdown(html: string, url: string): string {
  const { document } = parseHTML(html)
  for (const el of document.querySelectorAll(DROP)) el.remove()
  // The "skip to content" and back links are page furniture, not content.
  for (const a of document.querySelectorAll('a[href="#main"]')) a.remove()
  const h1 = document.querySelector('h1')
  const band = h1?.closest('header') ? h1.parentElement : null
  const parts = [...(band ? blocks(band, url) : []), ...blocks(document.querySelector('main')!, url)]
  return `${parts.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`
}
