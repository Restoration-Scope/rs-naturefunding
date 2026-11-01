/**
 * Writes JSON the way the data files are written by hand: two-space indent, and an
 * object or array on one line when it fits in 100 columns. Keeps refresh diffs small.
 */
const WIDTH = 100

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }` : '{}'
  }
  return JSON.stringify(value)
}

function format(value: unknown, indent: string, prefix: string, suffix: string): string {
  const one = inline(value)
  const isContainer = value !== null && typeof value === 'object'
  if (!isContainer || indent.length + prefix.length + one.length + suffix.length <= WIDTH) return `${indent}${prefix}${one}${suffix}`
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}${prefix}[]${suffix}`
    const items = value.map((v, i) => format(v, inner, '', i < value.length - 1 ? ',' : ''))
    return `${indent}${prefix}[\n${items.join('\n')}\n${indent}]${suffix}`
  }
  const entries = Object.entries(value as object).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return `${indent}${prefix}{}${suffix}`
  const items = entries.map(([k, v], i) => format(v, inner, `${JSON.stringify(k)}: `, i < entries.length - 1 ? ',' : ''))
  return `${indent}${prefix}{\n${items.join('\n')}\n${indent}}${suffix}`
}

export const formatJson = (value: unknown) => `${format(value, '', '', '')}\n`
