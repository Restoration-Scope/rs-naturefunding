// The finder's "Download CSV": /data.csv (src/pages/data.csv.ts) cut down to the programmes the view shows, one
// row each, in the order it shows them. Same columns as the full file, so a spreadsheet built on one takes the other.

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

/** The cells of one record, unquoted. */
export function csvFields(record: string): string[] {
  const fields: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < record.length; i++) {
    const ch = record[i]
    if (quoted) {
      if (ch === '"' && record[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      fields.push(cur)
      cur = ''
    } else cur += ch
  }
  fields.push(cur)
  return fields
}

/**
 * The header plus one record per shown programme, in `shown` order: the record of the call its row shows, or its
 * first record when the row shows no call (a programme with no call has just one).
 */
export function pickProgrammes(text: string, shown: { id: string; call?: string }[]): string {
  const [header = '', ...rows] = csvRecords(text)
  const callCol = header.split(',').indexOf('call_id')
  const byId = new Map<string, string[]>()
  for (const r of rows) {
    const id = r.slice(0, r.indexOf(','))
    byId.set(id, [...(byId.get(id) ?? []), r])
  }
  const picked = shown.flatMap(({ id, call }) => {
    const records = byId.get(id) ?? []
    const match = call ? records.find((r) => csvFields(r)[callCol] === call) : undefined
    return match ?? records[0] ?? []
  })
  return `${[header, ...picked].join('\n')}\n`
}

/** naturefunding-<page>-<date>.csv, e.g. naturefunding-countries-kenya-2026-11-20.csv. */
export function csvFileName(pathname: string, date: string) {
  const page = pathname.split('/').filter(Boolean).join('-')
  return `naturefunding-${page ? `${page}-` : ''}${date}.csv`
}
