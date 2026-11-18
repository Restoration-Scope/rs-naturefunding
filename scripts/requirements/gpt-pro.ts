/**
 * GPT Pro (chatgpt.com, Bernat's Pro plan) as the first reader. It finds and reads the funder's own pages
 * and documents itself, and answers in the extractor's wire shape with each quote's URL in place of D1, D2….
 * The answer is stored per programme; run.ts --answers then gathers our own copy of every page it cites,
 * re-checks each quote there, and runs Jev and escalation as usual. GPT's word alone never sets a fact or a stamp.
 *
 *   bun scripts/requirements/gpt-pro.ts order [N]          the next N programmes without an answer, finder order
 *   bun scripts/requirements/gpt-pro.ts prompt <id>         the prompt to paste
 *   bun scripts/requirements/gpt-pro.ts save <id> <file> <conversation url>   parse an answer and store it
 *
 * The browser part (pasting prompts, collecting answers) is done by an agent in Chrome; it has no API.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Programme } from '../../src/data/schema'
import { apiWire, SYSTEM } from './extract'
import { seedsOf } from './gather'
import { readManifest } from './queue'

export const ANSWERS_DIR = join(process.cwd(), 'data', 'requirements', 'gpt-pro')
export const answerPath = (id: string) => join(ANSWERS_DIR, `${id}.json`)
export const GPT_PRO_VERSION = 'gpt-pro-2026-11-17.1'

/** The extractor's answer, plus every URL GPT Pro read. Quotes name their URL in `doc`. */
export const proWire = apiWire.extend({
  read: z.array(z.string()).describe('Every funder page or document URL you read for this answer.'),
})
export type ProWire = z.infer<typeof proWire>

export type Answer = { id: string; model: string; version: string; asked_on: string; conversation: string; answer: ProWire }

/** The extractor's rules, with URLs where it says D1, D2…. */
const system = SYSTEM.replace(
  'Every item has "doc" (D1, D2…) and "quote"',
  'Every item has "doc" (the exact URL of the page or document the quote is from) and "quote"',
).replace('that are not among the documents you were given, by name or link', 'that you could not open or read, by name or link')

export function promptFor(p: Programme): string {
  const rounds = p.calls.map((c) => `${c.label} (${c.status}${c.deadline ? `, deadline ${c.deadline.date}` : ''})`).join('; ') || 'none listed'
  return [
    system,
    '',
    'How to work:',
    "- Browse the funder’s own website: start from the pages below, then find and open the current call's guidelines, call text, FAQ, application instructions, terms and grant agreement, including PDFs. Use only the funder’s own pages and files (or the body that runs the programme for it). Never use a directory, a news story or another site’s summary.",
    '- Quote the page text exactly as the page shows it. We fetch every URL you cite and drop any quote we cannot find on it, so copy carefully and give the URL you actually read (the PDF’s own URL for a PDF).',
    '- "read": every funder URL you opened for this answer, including ones that held nothing useful.',
    '- Reply with one JSON object in a single ```json code block and nothing else. Every key in the shape below is required.',
    '',
    `Programme: ${p.name}`,
    `Funder: ${p.funder.name}${p.administered_by ? `, run by ${p.administered_by.name}` : ''}`,
    `Rounds we list: ${rounds}`,
    `Who may apply, as we list it: ${p.applicant_types?.join(', ') ?? 'not stated'}. Where: ${p.geography ? JSON.stringify(p.geography) : 'not stated'}.`,
    'Pages we cite:',
    ...seedsOf(p).map((u) => `- ${u}`),
    '',
    'Shape (JSON Schema):',
    JSON.stringify(z.toJSONSchema(proWire)).replaceAll('The document the quote is from: D1, D2…', 'The exact URL the quote is from.'),
  ].join('\n')
}

/** The JSON object in an answer's text: the last ```json block, else the outermost braces. */
export function parseAnswer(text: string): ProWire {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]!)
  const raw = blocks.at(-1) ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return proWire.parse(JSON.parse(raw))
}

export const readAnswer = (id: string): Answer | null => (existsSync(answerPath(id)) ? (JSON.parse(readFileSync(answerPath(id), 'utf8')) as Answer) : null)

if (import.meta.main) {
  const [cmd, a, b, c] = process.argv.slice(2)
  if (cmd === 'order') {
    const { listings, sortListings } = await import('../../src/lib/data')
    const gold = JSON.parse(readFileSync('tests/fixtures/requirements/index.json', 'utf8')) as { programmes: { id: string }[] }
    const goldIds = new Set(gold.programmes.map((g) => g.id))
    const seen = new Set<string>()
    const ids = [...listings]
      .sort(sortListings)
      .map((l) => l.p)
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .filter((p) => !goldIds.has(p.id) && !readAnswer(p.id) && !readManifest(p.id)?.requirements_checked)
    console.log(ids.slice(0, Number(a ?? 20)).map((p) => p.id).join('\n'))
  } else if (cmd === 'prompt') {
    const { loadData } = await import('../../src/data/load')
    const p = loadData().programmes.find((x) => x.id === a)
    if (!p) throw new Error(`no programme ${a}`)
    console.log(promptFor(p))
  } else if (cmd === 'save') {
    if (!a || !b || !c) throw new Error('save <id> <answer file> <conversation url>')
    const answer = parseAnswer(readFileSync(b, 'utf8'))
    mkdirSync(ANSWERS_DIR, { recursive: true })
    const out: Answer = { id: a, model: 'gpt-pro (chatgpt.com)', version: GPT_PRO_VERSION, asked_on: new Date().toISOString().slice(0, 10), conversation: c, answer }
    writeFileSync(answerPath(a), `${JSON.stringify(out, null, 2)}\n`)
    console.log(`${a}: ${answer.read.length} URLs read, ${answer.eligibility.items.length} rules, ${answer.documents.items.length} documents, ${answer.effort.steps.length} steps`)
  } else throw new Error('order [N] | prompt <id> | save <id> <file> <url>')
}
