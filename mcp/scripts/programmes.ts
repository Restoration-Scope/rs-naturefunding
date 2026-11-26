// What the Worker bundles: the validated programmes without their evidence (quotes, sources), which search never
// reads and get_grant takes from the site's Markdown twin. Keeps the script small as the directory grows.
import { loadProgrammes } from '../../src/data/load'
import type { Programme } from '../../src/data/schema'

export function searchProgrammes(): Programme[] {
  return loadProgrammes().map((p) => ({
    ...p,
    evidence: {},
    calls: p.calls.map((c) => ({ ...c, evidence: {} })),
  })) as Programme[]
}
