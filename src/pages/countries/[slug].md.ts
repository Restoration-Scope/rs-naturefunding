import type { APIRoute, GetStaticPaths } from 'astro'
import { finderPageMarkdown } from '../../lib/agent'
import { finderPages, inPlace, type FinderPage } from '../../lib/finder-pages'

export const getStaticPaths = (() =>
  finderPages.countries.map((page) => ({ params: { slug: page.path.split('/').at(-2)! }, props: { page } }))) satisfies GetStaticPaths

/** The programmes for a group the country may be in, apart from the ones that take it, with the same lines and rules. */
function checkSection(page: FinderPage): string {
  if (!page.check.length) return ''
  const lines = finderPageMarkdown({ ...page, listings: page.check }).split('\n')
  const rows = lines.slice(lines.findIndex((l) => l.startsWith('## '))).map((l) => l.replace(/^## /, '### '))
  return `\n## May not take ${inPlace(page.name)}: check the place\n\nThe funder names a group of places without listing its countries. Ask the funder before counting on one of these.\n\n${rows.join('\n')}`
}

export const GET: APIRoute = ({ props }) => {
  const { page } = props as { page: FinderPage }
  return new Response(finderPageMarkdown(page) + checkSection(page), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
