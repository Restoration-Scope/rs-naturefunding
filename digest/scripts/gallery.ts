// Every email the Worker sends, side by side on one page: digest/preview/gallery.html (gitignored). Each one is
// rendered by the Worker's own code (digest/src/email.ts) from the real data and its git history, so the page is
// exactly what goes out. Run from the repo root:
//   bun digest/scripts/gallery.ts                   digests of the last 14 days
//   bun digest/scripts/gallery.ts --since 2026-11-05
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadProgrammes } from '../../src/data/load'
import { buildDigest } from '../src/digest'
import { confirmationEmail, digestEmail, type Email } from '../src/email'
import { cleanPrefs } from '../src/match'
import { eventsFromHistory } from './history'
import { loadPagePaths } from './pages'

const SITE = 'https://naturefunding.org'
const args = process.argv.slice(2)
const sinceArg = args[args.indexOf('--since') + 1]
const now = new Date()
const since = args.includes('--since') && sinceArg ? new Date(sinceArg) : new Date(now.getTime() - 14 * 86_400_000)

const programmes = new Map(loadProgrammes().map((p) => [p.id, p]))
const events = eventsFromHistory(365, 'HEAD')
const pages = loadPagePaths()

type Sample = { label: string; note: string; email: Email | null }

function digestSample(label: string, note: string, where: string, approaches: string[], currency = ''): Sample {
  const prefs = cleanPrefs(where, approaches)
  const digest = buildDigest(events, programmes, prefs, since.toISOString(), now.toISOString())
  if (digest.items.length === 0) return { label, note: `${note} Nothing new since ${since.toISOString().slice(0, 10)}: no email goes out.`, email: null }
  const email = digestEmail({
    site: SITE,
    pages,
    digest,
    prefs,
    currency,
    since: since.toISOString(),
    unsubscribeUrl: 'https://email.naturefunding.org/unsubscribe?t=sample',
    manageUrl: `${SITE}/digest/`,
  })
  return { label, note, email }
}

const confirmUrl = 'https://email.naturefunding.org/confirm?t=sample'
const samples: Sample[] = [
  digestSample('Weekly · no choices', 'Signed up without a country or project type: every section, cut to the first items.', '', []),
  digestSample('Weekly · a country', 'Costa Rica: the heading names it, so cards leave the place out.', 'CR', []),
  digestSample('Weekly · a region', 'Asia: each card says where in the region it is open.', 'r:asia', []),
  digestSample('Weekly · a project type', 'Forests (reforestation): cards leave the project types out.', '', ['reforestation']),
  digestSample('Weekly · country and type', 'Kenya, species conservation: cards leave both the place and the types out.', 'KE', ['species_conservation']),
  digestSample('Weekly · another currency', 'No choices, amounts in euros with the funder’s figure in brackets.', '', [], 'EUR'),
  { label: 'Confirmation · with choices', note: 'Sent when someone signs up for Kenya and reforestation.', email: confirmationEmail({ site: SITE, confirmUrl, prefs: cleanPrefs('KE', ['reforestation']) }) },
  { label: 'Confirmation · no choices', note: 'Sent when someone signs up for everything, amounts in euros.', email: confirmationEmail({ site: SITE, confirmUrl, prefs: cleanPrefs('', []), currency: 'EUR' }) },
]

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const columns = samples
  .map(
    (s) => `<section class="col">
  <h2>${esc(s.label)}</h2>
  <p class="note">${esc(s.note)}</p>
  ${
    s.email
      ? `<p class="subject"><span>Subject</span> ${esc(s.email.subject)}</p>
  <iframe title="${esc(s.label)}" srcdoc="${esc(s.email.html)}" onload="fit(this)"></iframe>
  <details><summary>Plain-text version</summary><pre>${esc(s.email.text)}</pre></details>`
      : '<div class="empty">No email</div>'
  }
</section>`,
  )
  .join('\n')

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Email gallery · naturefunding.org</title>
<style>
  :root { --bg: #f7f4ef; --ink: #1b2722; --ink2: #565e5b; --rule: #d8d7d2; --brand: #3a7e49; --w: 640px; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
  header { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: baseline; padding: 14px 24px; background: var(--bg); border-bottom: 1px solid var(--rule); }
  h1 { margin: 0; font: 400 22px/1.3 'Geist Serif', Georgia, serif; }
  header p { margin: 0; color: var(--ink2); }
  .widths { margin-left: auto; display: flex; gap: 6px; }
  .widths button { font: inherit; padding: 4px 12px; border: 1px solid var(--rule); border-radius: 6px; background: #fff; color: var(--ink); cursor: pointer; }
  .widths button[aria-pressed='true'] { background: var(--ink); border-color: var(--ink); color: #fff; }
  .widths button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  main { display: flex; gap: 24px; overflow-x: auto; padding: 24px; align-items: flex-start; }
  .col { flex: 0 0 var(--w); max-width: calc(100vw - 48px); }
  h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .note { margin: 2px 0 8px; color: var(--ink2); }
  .subject { margin: 0 0 10px; font-size: 14px; }
  .subject span { color: var(--ink2); }
  iframe { display: block; width: 100%; height: 900px; border: 1px solid var(--rule); border-radius: 8px; background: #edeae7; }
  details { margin-top: 8px; color: var(--ink2); }
  pre { white-space: pre-wrap; font-size: 12px; background: #fff; border: 1px solid var(--rule); border-radius: 8px; padding: 12px; color: var(--ink); }
  .empty { padding: 40px; text-align: center; color: var(--ink2); border: 1px dashed var(--rule); border-radius: 8px; }
</style></head>
<body>
<header>
  <h1>Every email we send</h1>
  <p>Rendered by the Worker’s own code from the real data, for digests since ${since.toISOString().slice(0, 10)}. Generated ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.</p>
  <div class="widths" role="group" aria-label="Width">
    <button type="button" data-w="640px" aria-pressed="true">Desktop</button>
    <button type="button" data-w="375px" aria-pressed="false">Phone</button>
  </div>
</header>
<main>
${columns}
</main>
<script>
  function fit(f) { try { f.style.height = '0px'; f.style.height = f.contentDocument.documentElement.scrollHeight + 2 + 'px' } catch {} }
  document.querySelectorAll('.widths button').forEach((b) => b.addEventListener('click', () => {
    document.documentElement.style.setProperty('--w', b.dataset.w)
    document.querySelectorAll('.widths button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)))
    requestAnimationFrame(() => document.querySelectorAll('iframe').forEach(fit))
  }))
</script>
</body></html>`

mkdirSync('digest/preview', { recursive: true })
writeFileSync('digest/preview/gallery.html', page)
console.log(`${samples.length} emails · since ${since.toISOString().slice(0, 10)}\ndigest/preview/gallery.html`)
