// Ask your AI (src/components/AskAi.astro): turns a line about a project into a prompt for the visitor's own
// assistant, starting it on the Markdown list for their place. Nothing is sent to us: the text leaves the page only
// in the address of the assistant the visitor opens, or through their clipboard.
import { resolvePage, type PagePaths } from './page-paths'
import { twinPath } from './twins'

const SITE = 'https://naturefunding.org'
export type Place = { code: string; name: string }

export const assistantUrls = {
  chatgpt: (prompt: string) => `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`,
  claude: (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
}
export type Assistant = keyof typeof assistantUrls

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** The one country the text names, or null for none or several. Guinea inside Papua New Guinea doesn't count. */
export function countryIn(text: string, places: Place[]): Place | null {
  let rest = ` ${plain(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const found: Place[] = []
  for (const p of [...places].sort((a, b) => b.name.length - a.name.length)) {
    const name = ` ${plain(p.name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
    if (!rest.includes(name)) continue
    found.push(p)
    rest = rest.replaceAll(name, ' | ')
  }
  return found.length === 1 ? found[0]! : null
}

/** The prompt. `where` is a Where value ("KE", "r:africa", ""); a country the text names wins over it. */
export function askPrompt(text: string, where: string, places: Place[], pages: PagePaths): string {
  const named = countryIn(text, places)
  const value = named?.code ?? where
  const path = value ? resolvePage(pages, value, '').path : '/'
  const list = path === '/' ? null : `${SITE}${twinPath(path)}`
  const place = named?.name ?? places.find((p) => p.code === value)?.name
  return [
    'Find grants my nature project can apply for, using naturefunding.org, a free directory that quotes each funder’s own page.',
    '',
    `My project: ${text.trim().replace(/\s+/g, ' ')}${place && !named ? ` (in ${place})` : ''}`,
    '',
    list
      ? `1. Open ${list} (grants for this place, open ones first). If that fails, pick the place from ${SITE}/countries.md.`
      : `1. Open ${SITE}/countries.md, then the list for my country or region.`,
    '2. Choose up to 8 that may fit, open or opening soon. Open each one and read it to the end: who can apply, where, the amount, the deadline, every rule and the steps.',
    '3. Give me the best 5 at most. For each: deadline, amount, the rules I meet, the rules I fail or you can’t tell, how to apply, and links to the naturefunding.org page (not its .md copy) and the funder’s page.',
    '',
    'Use only what those pages say. Don’t guess a deadline or a rule: “not found” means the funder’s page doesn’t say. If nothing fits well, say so and tell me the closest. List any page you couldn’t open. End with the questions whose answers would change the list.',
  ].join('\n')
}

export function initAskAi(root: HTMLElement) {
  const input = root.querySelector('textarea')!
  const status = root.querySelector<HTMLElement>('[data-ask-ai-status]')!
  const finder = document.querySelector<HTMLFormElement>('[data-ask]')!
  const select = finder.querySelector<HTMLSelectElement>('select[name="where"]')!
  const pages: PagePaths = JSON.parse(finder.dataset.pages ?? '{}')
  const places = [...select.options].map((o) => ({ code: o.value, name: o.text })).filter((p) => /^[A-Z]{2}$/.test(p.code))

  const prompt = () => {
    if (input.value.trim()) return askPrompt(input.value, select.value, places, pages)
    status.textContent = 'Say something about your project first.'
    input.focus()
    return null
  }
  input.addEventListener('input', () => (status.textContent = ''))
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-ask-ai]'))
    b.addEventListener('click', async () => {
      const text = prompt()
      if (!text) return
      const to = b.dataset.askAi!
      if (to !== 'copy') {
        window.open(assistantUrls[to as Assistant](text), '_blank', 'noopener')
        return
      }
      try {
        await navigator.clipboard.writeText(text)
        status.textContent = 'Copied. Paste it into any AI assistant that can open web pages.'
      } catch {
        status.textContent = 'Your browser blocked the copy. Use one of the other buttons.'
      }
    })
}
