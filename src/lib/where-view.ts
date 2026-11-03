// The programme page, read for the finder's Where (?where=CR or ?where=r:africa). Every version of the apply
// box renders at build time; this picks one, says whether the place is covered and folds calls for elsewhere.
// Exploration: ?v=a tailors the page, ?v=b keeps it general and flags what differs, ?v=c tailors it and lets
// the visitor change the place on the page.
import { countryName, countryRegion, regionLabels, type Region } from './geo'

type Variant = 'a' | 'b' | 'c'

const all = <T extends Element>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)]

/** The finder's own rule (src/lib/finder.ts whereMatches): does a programme's codes take this place? */
function covers(codes: string[], where: string) {
  if (codes.includes('*')) return true
  if (where.startsWith('r:')) return codes.includes(where) || codes.includes(`R:${where.slice(2)}`)
  const region = countryRegion[where]
  return codes.includes(where) || (!!region && codes.includes(`R:${region}`))
}

const placeName = (where: string) => (where.startsWith('r:') ? (regionLabels[where.slice(2) as Region] ?? where) : countryName(where))

export function initWhereView() {
  const root = document.querySelector<HTMLElement>('[data-where-codes]')
  if (!root) return
  const codes = (root.dataset.whereCodes ?? '').split(' ').filter(Boolean)
  const calls = all<HTMLDetailsElement>('[data-call-countries]')
  const callsHome = calls[0]?.parentElement ?? null
  const callsAnchor = document.querySelector<HTMLElement>('[data-calls-other]')
  const callsTitle = document.querySelector<HTMLElement>('[data-calls-title]')
  const callsTitleText = callsTitle?.textContent?.trim() ?? ''
  const openAtBuild = new Map(calls.map((c) => [c, c.open]))
  const back = all<HTMLAnchorElement>('[data-back]')
  const backText = document.querySelector<HTMLElement>('[data-back-text]')

  // Back goes to the finder the visitor came from, with every filter it had.
  const ref = document.referrer ? new URL(document.referrer) : null
  const fromFinder = ref && ref.origin === location.origin && ref.pathname === '/' ? ref.href : null

  function render() {
    const sp = new URLSearchParams(location.search)
    const where = sp.get('where') ?? ''
    const v = (['a', 'b', 'c'].includes(sp.get('v') ?? '') ? sp.get('v') : 'a') as Variant
    const tailor = v !== 'b'
    const name = where ? placeName(where) : ''
    const covered = where ? covers(codes, where) : true
    // A country inside one call group's countries; a region never narrows the calls.
    const country = where && !where.startsWith('r:') ? where : ''

    for (const el of all('[data-where-name]')) el.textContent = name
    show('[data-where-chip]', !!where && tailor)
    for (const a of all<HTMLAnchorElement>('[data-where-clear]')) a.href = withParams({ where: null })

    // The apply box: the group whose calls take this country, the uncovered box, else the general one.
    const boxes = all<HTMLElement>('[data-apply-for]')
    const group = country ? boxes.find((b) => b.dataset.applyFor!.split(' ').includes(country)) : undefined
    const pick = !tailor || !where ? '' : !covered ? 'none' : (group?.dataset.applyFor ?? '')
    for (const b of boxes) b.hidden = b.dataset.applyFor !== pick

    // B: a note in the general box.
    show('[data-where-note]', !!where && !tailor)
    const noteKey = !covered ? 'none' : (group?.dataset.applyFor ?? 'covered')
    for (const p of all<HTMLElement>('[data-note-for]')) p.hidden = p.dataset.noteFor !== noteKey

    // C: the place can change here.
    for (const l of all<HTMLElement>('[data-where-switch]')) l.hidden = v !== 'c'
    for (const s of all<HTMLSelectElement>('[data-where-select]')) {
      if (where && ![...s.options].some((o) => o.value === where)) s.add(new Option(`${name} (not covered)`, where))
      s.value = where
    }

    // The Where fact: covered or not, and through which call.
    show('[data-where-covered]', !!where && covered)
    show('[data-where-uncovered]', !!where && !covered)
    const via = document.querySelector<HTMLElement>('[data-where-via]')
    const groupCall = group && calls.find((c) => c.dataset.callCountries === group.dataset.applyFor)
    if (via) via.textContent = groupCall ? `, in the call “${groupCall.dataset.callLabel}”` : ''

    // Calls: whether each takes the place (B), or the place's first and the rest folded (A, C).
    const takes = (c: HTMLElement) => !country || !c.dataset.callCountries || c.dataset.callCountries.split(' ').includes(country)
    for (const c of calls) {
      const fit = c.querySelector<HTMLElement>('[data-call-fit]')
      if (fit) {
        fit.hidden = !where || tailor || !covered
        fit.textContent = takes(c) ? `✓ Takes projects in ${name}` : `✕ Not for ${name}`
        fit.className = `text-md font-semibold ${takes(c) ? 'text-ok-ink' : 'text-warn-ink'}`
      }
    }
    const folded = tailor && country && covered ? calls.filter((c) => !takes(c)) : []
    const list = document.querySelector<HTMLElement>('[data-calls-other-list]')
    if (callsHome && callsAnchor && list) {
      for (const c of calls) {
        if (folded.includes(c)) list.append(c)
        else callsHome.insertBefore(c, callsAnchor)
        c.open = folded.length && !folded.includes(c) ? true : openAtBuild.get(c)!
      }
      callsAnchor.hidden = folded.length === 0
      const n = callsAnchor.querySelector('[data-calls-other-count]')
      if (n) n.textContent = String(folded.length)
    }
    if (callsTitle) {
      const mine = calls.length - folded.length
      callsTitle.textContent = folded.length ? `${mine === 1 ? 'The call' : `Calls (${mine})`} for ${name}` : callsTitleText
    }

    // Back to the finder, filtered for this place when we don't know the visitor's full filters.
    const backHref = fromFinder ?? (where ? `/?where=${encodeURIComponent(where)}#results` : '/')
    for (const a of back) a.href = backHref
    if (backText) backText.textContent = where ? `Funding in ${name}` : 'All funding'

    // The exploration bar marks what's on.
    for (const a of all<HTMLAnchorElement>('[data-v]')) {
      a.href = withParams({ v: a.dataset.v! })
      a.toggleAttribute('aria-current', a.dataset.v === v)
    }
    for (const a of all<HTMLAnchorElement>('[data-w]')) {
      a.href = withParams({ where: a.dataset.w || null })
      a.toggleAttribute('aria-current', a.dataset.w === where)
    }
  }

  function show(sel: string, on: boolean) {
    for (const el of all<HTMLElement>(sel)) el.hidden = !on
  }

  function withParams(set: Record<string, string | null>) {
    const sp = new URLSearchParams(location.search)
    for (const [k, val] of Object.entries(set)) val ? sp.set(k, val) : sp.delete(k)
    const q = sp.toString()
    return `${location.pathname}${q ? `?${q}` : ''}`
  }

  for (const s of all<HTMLSelectElement>('[data-where-select]')) {
    s.addEventListener('change', () => {
      history.replaceState(null, '', withParams({ where: s.value || null }))
      render()
    })
  }
  // The exploration bar and "See every country" swap the view in place.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('[data-v], [data-w], [data-where-clear]')
    if (!a) return
    e.preventDefault()
    history.replaceState(null, '', a.href)
    render()
  })
  render()
}
