import type { AstroIntegration } from 'astro'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pageMarkdown } from '../lib/html-markdown'
import { absolute } from '../lib/site'
import { LLMS_FULL_PAGES } from '../lib/twins'

/** Hand-written prose pages. Their Markdown twins are converted from the built HTML; data pages build theirs from the data. */
export const PROSE_PAGES = ['/about/', '/data/']

/** After the build: writes /about.md and /data.md from their pages, and adds them to llms-full.txt. */
export function proseTwins(): AstroIntegration {
  return {
    name: 'prose-twins',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const out = fileURLToPath(dir)
        const twins = PROSE_PAGES.map((path) => {
          const md = pageMarkdown(readFileSync(`${out}${path.slice(1)}index.html`, 'utf8'), absolute(path))
          writeFileSync(`${out}${path.slice(1, -1)}.md`, md)
          return md
        })
        const full = `${out}llms-full.txt`
        const demoted = twins.map((md) => md.replace(/^(#+) /gm, '#$1 ').trim()).join('\n\n')
        writeFileSync(full, readFileSync(full, 'utf8').replace(LLMS_FULL_PAGES, demoted))
      },
    },
  }
}
