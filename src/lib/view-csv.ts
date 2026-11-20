// The finder's "Download CSV": /data.csv (src/pages/data.csv.ts) cut down to the programmes the view shows, in
// the order it shows them. Same columns as the full file, so a spreadsheet built on one takes the other.

/** Splits CSV text into records, keeping newlines inside quoted cells. Each record keeps its own quoting. */
export function csvRecords(text: string): string[] {
  const records: string[] = []
  let start = 0
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') quoted = !quoted
    else if (ch === '\n' && !quoted) {
      records.push(text.slice(start, i))
      start = i + 1
    }
  }
  if (start < text.length) records.push(text.slice(start))
  return records
}

/** The header plus every record whose programme_id (the first column) is in `ids`, grouped in `ids` order. */
export function pickProgrammes(text: string, ids: string[]): string {
  const [header = '', ...rows] = csvRecords(text)
  const byId = new Map<string, string[]>()
  for (const r of rows) {
    const id = r.slice(0, r.indexOf(','))
    byId.set(id, [...(byId.get(id) ?? []), r])
  }
  return `${[header, ...ids.flatMap((id) => byId.get(id) ?? [])].join('\n')}\n`
}

/** naturefunding-<page>-<date>.csv, e.g. naturefunding-countries-kenya-2026-11-20.csv. */
export function csvFileName(pathname: string, date: string) {
  const page = pathname.split('/').filter(Boolean).join('-')
  return `naturefunding-${page ? `${page}-` : ''}${date}.csv`
}
