// The finder's "Download CSV": /data.csv (src/pages/data.csv.ts) cut down to the programmes the view shows, one
// row each, in the order it shows them. Same columns as the full file, so a spreadsheet built on one takes the other.

const CALL_COLUMNS = new Set([
  'call_id', 'call', 'call_status', 'opens', 'opens_expected', 'deadline_date', 'deadline_text', 'dates_each_year', 'call_note', 'call_countries', 'call_url',
])

/** One cell's text, quoted when it needs it. */
export const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)

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
 * The header plus one record per shown programme, in `shown` order: the record of the call its row shows. A row
 * showing no call takes its first record for every country, or the programme alone, with its call's columns empty,
 * when each call is for some countries: those may be others than the page's. Null when a programme or call
 * the page shows is no longer in the file: the page is older than the data, and a reload fixes it.
 */
export function pickProgrammes(text: string, shown: { id: string; call?: string }[]): string | null {
  const [header = '', ...rows] = csvRecords(text)
  const columns = header.split(',')
  const callCol = columns.indexOf('call_id')
  const countriesCol = columns.indexOf('call_countries')
  const withoutCall = (record: string) =>
    csvFields(record).map((v, i) => (CALL_COLUMNS.has(columns[i]!) ? '' : csvCell(v))).join(',')
  const byId = new Map<string, string[]>()
  for (const r of rows) {
    const id = r.slice(0, r.indexOf(','))
    byId.set(id, [...(byId.get(id) ?? []), r])
  }
  const picked: string[] = []
  for (const { id, call } of shown) {
    const records = byId.get(id) ?? []
    const record = call
      ? records.find((r) => csvFields(r)[callCol] === call)
      : (records.find((r) => !csvFields(r)[countriesCol]) ?? (records[0] && withoutCall(records[0])))
    if (!record) return null
    picked.push(record)
  }
  return `${[header, ...picked].join('\n')}\n`
}

/** naturefunding-<page>-<date>.csv, e.g. naturefunding-countries-kenya-2026-11-20.csv. */
export function csvFileName(pathname: string, date: string) {
  const page = pathname.split('/').filter(Boolean).join('-')
  return `naturefunding-${page ? `${page}-` : ''}${date}.csv`
}

/** Fetches /data.csv, cuts it to the `shown` programmes and saves it. Throws when the fetch fails or the page is stale. */
export async function saveViewCsv(shown: { id: string; call?: string }[], pathname: string, date: string) {
  const res = await fetch('/data.csv')
  if (!res.ok) throw new Error(String(res.status))
  const csv = pickProgrammes(await res.text(), shown)
  if (csv === null) throw new Error('stale')
  // The byte-order mark makes Excel read it as UTF-8, so names like Galápagos keep their accents.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = csvFileName(pathname, date)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
