// The programme page, read for the finder's Where (?where=CR or ?where=r:africa). The built page shows every
// country's calls; this only narrows it: the apply box to the part for that place, the calls for elsewhere
// folded, and a line on whether the place is covered. What it adds comes from the page's <template>s, so a
// text reader of the built page never meets text a visitor can't see.

const all = <T extends Element>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)]

export function initWhereView() {
  const root = document.querySelector<HTMLElement>('[data-where-codes]')
  if (!root) return
  // Each region the programme takes is spelled out as its countries (src/lib/data.ts whereReach).
  const reach = new Set((root.dataset.whereCodes ?? '').split(' '))
  const regionNames: Record<string, string> = JSON.parse(root.dataset.regionNames ?? '{}')
  const countryNames = new Intl.DisplayNames(['en'], { type: 'region' })
  const nameOf = (w: string) => (w.startsWith('r:') ? (regionNames[w.slice(2)] ?? w) : (countryNames.of(w) ?? w))
  const covers = (w: string) => reach.has('*') || reach.has(w) || (w.startsWith('r:') && reach.has(`R:${w.slice(2)}`))

  const box = document.querySelector<HTMLElement>('[data-apply]')
  const parts = all<HTMLElement>('[data-group]', box ?? document)
  const select = document.querySelector<HTMLSelectElement>('[data-where-select]')
  const calls = all<HTMLDetailsElement>('[data-call-countries]')
  const callsHome = calls[0]?.parentElement ?? null
  const builtOpen = new Map(calls.map((c) => [c, c.open]))
  const callsTitle = document.querySelector<HTMLElement>('[data-calls-title]')
  const builtCallsTitle = callsTitle?.textContent?.trim() ?? ''
  const backText = document.querySelector<HTMLElement>('[data-back-text]')
  const cta = document.querySelector<HTMLElement>('[data-cta]')
  const ctaLabel = cta?.querySelector<HTMLElement>('[data-cta-label]')
  const ctaButton = cta?.querySelector<HTMLAnchorElement>('[data-cta-button]')
  const builtCta = { label: ctaLabel?.textContent ?? '', href: ctaButton?.getAttribute('href') ?? '', text: ctaButton?.textContent ?? '' }
  const tpl = (name: string) => document.querySelector<HTMLTemplateElement>(`[data-where-tpl="${name}"]`)

  // Back goes to the finder the visitor came from, with every filter it had.
  const ref = document.referrer ? new URL(document.referrer) : null
  const finder = ref && ref.origin === location.origin && ref.pathname === '/' ? ref : null

  /** Puts a template's content right after it, marked so the next render can take it away. */
  function place(name: string): HTMLElement | null {
    const t = tpl(name)
    const el = t?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined
    if (!t || !el) return null
    el.dataset.whereMade = ''
    t.after(el)
    return el
  }

  function render() {
    const where = new URLSearchParams(location.search).get('where') ?? ''
    const name = where ? nameOf(where) : ''
    const covered = !where || covers(where)
    const country = where && !where.startsWith('r:') ? where : ''

    // Start from the built page: calls home in their order, nothing added.
    if (callsHome) for (const c of calls) callsHome.insertBefore(c, tpl('other-calls'))
    for (const el of all('[data-where-made]')) el.remove()

    // The apply box: the part whose calls take this country, else the part for the rest; all of them without one.
    const part =
      covered && country && parts.length > 1
        ? (parts.find((p) => p.dataset.group!.split(' ').includes(country)) ?? parts.find((p) => p.dataset.group === '*'))
        : undefined
    for (const p of parts) p.hidden = !covered || (!!part && p !== part)
    box?.toggleAttribute('data-narrowed', !!part)
    if (!covered) place('none')
    if (select) {
      if (where && ![...select.options].some((o) => o.value === where)) select.add(new Option(`${name} (not covered)`, where))
      select.value = where
    }

    if (where) {
      place('chip')
      if (covered) {
        const via = place('covered')?.querySelector<HTMLElement>('[data-where-via]')
        if (via && part?.dataset.callLabel && part.dataset.group !== '*') via.textContent = `, in the call “${part.dataset.callLabel}”`
      } else place('uncovered')
    }

    // Calls: the place's own first and open; the others fold below.
    const takes = (c: HTMLElement) => !c.dataset.callCountries || c.dataset.callCountries.split(' ').includes(country)
    const others = part ? calls.filter((c) => !takes(c)) : []
    for (const c of calls) c.open = part && takes(c) ? true : builtOpen.get(c)!
    if (others.length) {
      const fold = place('other-calls')
      fold?.querySelector('[data-calls-other-list]')?.append(...others)
      const n = fold?.querySelector('[data-calls-other-count]')
      if (n) n.textContent = String(others.length)
    }
    if (callsTitle) {
      const mine = calls.length - others.length
      callsTitle.textContent = others.length ? `${mine === 1 ? 'The call' : `Calls (${mine})`} for ${name}` : builtCallsTitle
    }

    // The button at the foot follows the apply box.
    const primary = part?.querySelector<HTMLAnchorElement>('[data-primary]')
    if (cta && ctaLabel && ctaButton) {
      cta.hidden = !covered || (!!part && !primary)
      ctaLabel.textContent = primary ? `Ready to apply to ${part!.dataset.callLabel}?` : builtCta.label
      ctaButton.href = primary?.getAttribute('href') ?? builtCta.href
      ctaButton.textContent = primary?.textContent ?? builtCta.text
    }

    for (const el of all('[data-where-name]')) el.textContent = name
    for (const a of all<HTMLAnchorElement>('[data-where-clear]')) a.href = location.pathname
    const back = finder ? new URL(finder) : new URL('/', location.origin)
    if (where) back.searchParams.set('where', where)
    else back.searchParams.delete('where')
    if (!finder && where) back.hash = 'results'
    for (const a of all<HTMLAnchorElement>('[data-back]')) a.href = back.href
    if (backText) backText.textContent = where ? `Funding in ${name}` : 'All funding'
  }

  function go(where: string) {
    history.replaceState(null, '', where ? `?where=${encodeURIComponent(where)}` : location.pathname)
    render()
  }
  select?.addEventListener('change', () => go(select.value))
  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('[data-where-clear]')) return
    e.preventDefault()
    go('')
  })
  render()
}
