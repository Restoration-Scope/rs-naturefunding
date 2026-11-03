// Which page shows a Where and project type pair. Shared by the build and the finder script, so it imports no data.

/** A page's preset: a Where value ("KE", "r:africa", or "") and a project type's approaches, sorted and space-separated. */
export const pageKey = (where: string, cat: string) => `${where}|${cat}`

export type PagePaths = Record<string, string>

/** The page for this pair, and the part of it no page holds, left for the address. */
export function resolvePage(pages: PagePaths, where: string, cat: string): { path: string; where: string; cat: string } {
  const exact = pages[pageKey(where, cat)]
  if (exact) return { path: exact, where: '', cat: '' }
  const byWhere = where ? pages[pageKey(where, '')] : undefined
  if (byWhere) return { path: byWhere, where: '', cat }
  const byType = cat ? pages[pageKey('', cat)] : undefined
  if (byType) return { path: byType, where, cat: '' }
  return { path: '/', where, cat }
}

/** The address of a pair: its page, with what's left as parameters. */
export function pageHref(pages: PagePaths, where: string, cat: string, extra = new URLSearchParams()) {
  const r = resolvePage(pages, where, cat)
  const sp = new URLSearchParams(extra)
  sp.delete('where')
  sp.delete('approach')
  if (r.cat) sp.set('approach', r.cat.split(' ').join(','))
  if (r.where) sp.set('where', r.where)
  const qs = sp.toString().replaceAll('%2C', ',').replaceAll('%3A', ':')
  return `${r.path}${qs ? `?${qs}` : ''}`
}
