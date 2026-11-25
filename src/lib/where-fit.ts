/** `all`: the funder takes the place. `check`: it names a group the place may be in, so a page says "check", never a yes. */
export type Fit = 'all' | 'check'

/** How a programme's where codes (whereCodes in where-codes.ts) fit a Where: "KE", "r:africa" or '' for anywhere; `region` is the country's. */
export function whereFit(codes: readonly string[], where: string, region?: string): Fit | null {
  if (!where || codes.includes('*')) return 'all'
  // A group with members in the region takes some projects there, as a country list does.
  if (where.startsWith('r:')) return [where, `R:${where.slice(2)}`, `?:${where.slice(2)}`].some((c) => codes.includes(c)) ? 'all' : null
  if (codes.includes(where) || (!!region && codes.includes(`R:${region}`) && !codes.includes(`!${where}`))) return 'all'
  return codes.includes(`?${where}`) ? 'check' : null
}
