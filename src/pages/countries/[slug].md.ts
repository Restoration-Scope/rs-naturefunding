import type { APIRoute, GetStaticPaths } from 'astro'
import { finderPageMarkdown } from '../../lib/agent'
import { placeNote } from '../../lib/format'
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

/** The lists' lines, with the part of the country a funder takes when it doesn't take all of it. */
function withParts(md: string, page: FinderPage): string {
  const parts = page.listings.map((l) => [l.p.id, placeNote(l.p.geography, page.iso2!)] as const).filter(([, note]) => note)
  return parts.reduce((s, [id, note]) => s.replace(new RegExp(`^(- .*/p/${id}\\.md\\).*)$`, 'm'), `$1 In ${inPlace(page.name)}: ${note.replace('Only', 'only')}.`), md)
}

export const GET: APIRoute = ({ props }) => {
  const { page } = props as { page: FinderPage }
  return new Response(withParts(finderPageMarkdown(page), page) + checkSection(page), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
