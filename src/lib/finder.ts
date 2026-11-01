// Browser-side finder: filters the server-rendered listings and keeps the filters in the URL.

const AGING_DAYS = 30
const HIDDEN_DAYS = 90
const MULTI = ['status', 'access', 'applicant', 'approach', 'size'] as const
type Multi = (typeof MULTI)[number]

type Item = {
  el: HTMLLIElement
  state: string
  deadline: string
  opens: string
  checked: string
  sets: Record<Multi, string[]>
  where: string[]
  text: string
}

type Filters = { q: string; within: string; where: string } & Record<Multi, string[]>

const today = new Date().toISOString().slice(0, 10)
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

export function initFinder() {
  const form = document.querySelector<HTMLFormElement>('[data-form]')
  const list = document.querySelector<HTMLOListElement>('[data-list]')
  if (!form || !list) return
  const laterList = document.querySelector<HTMLOListElement>('[data-list-later]')!
  const later = document.querySelector<HTMLDetailsElement>('[data-later]')!
  const laterCount = document.querySelector<HTMLElement>('[data-later-count]')!
  // Rows with no call open now (no open call, or closed) wait in a folded list below the rest.
  const isLater = (state: string) => state === 'none' || state === 'closed'

  const details = document.querySelector<HTMLDetailsElement>('[data-filters]')!
  const countEl = document.querySelector<HTMLElement>('[data-result-count]')!
  const emptyEl = document.querySelector<HTMLElement>('[data-empty]')!
  const chipsEl = document.querySelector<HTMLElement>('[data-chips]')!
  const badge = document.querySelector<HTMLElement>('[data-filter-count]')!
  const whereSelect = form.querySelector<HTMLSelectElement>('select[name="where"]')!

  const wide = matchMedia('(min-width: 60rem)')
  const syncOpen = () => {
    if (wide.matches) details.open = true
  }
  syncOpen()
  wide.addEventListener('change', syncOpen)

  // Phones: the open filters panel closes onto the results.
  const done = form.querySelector<HTMLButtonElement>('[data-filters-done]')!
  done.addEventListener('click', () => {
    details.open = false
    document.querySelector('.results')?.scrollIntoView({ block: 'start' })
  })

  for (const set of form.querySelectorAll<HTMLElement>('[data-more]')) {
    const toggle = set.querySelector<HTMLButtonElement>('[data-more-toggle]')!
    set.dataset.collapsed = ''
    toggle.hidden = false
    toggle.addEventListener('click', () => {
      const expand = 'collapsed' in set.dataset
      if (expand) delete set.dataset.collapsed
      else set.dataset.collapsed = ''
      toggle.textContent = expand ? 'Show fewer' : (toggle.dataset.label ?? '')
      toggle.setAttribute('aria-expanded', String(expand))
    })
  }

  const rows = [...list.querySelectorAll<HTMLLIElement>(':scope > li'), ...laterList.querySelectorAll<HTMLLIElement>(':scope > li')]
  const items = rows.flatMap((el): Item[] => {
    const d = el.dataset
    const checked = d.checked ?? ''
    const age = days(checked, today)
    if (age > HIDDEN_DAYS) {
      el.remove()
      return []
    }
    if (age > AGING_DAYS) {
      el.querySelector('.tag')?.setAttribute('data-aging', '')
      el.querySelector<HTMLElement>('.checked__aging')?.removeAttribute('hidden')
    }
    let state = d.state ?? ''
    const deadline = d.deadline ?? ''
    if (state === 'open' && deadline) {
      const left = days(today, deadline)
      const leftEl = el.querySelector<HTMLElement>('[data-left]')
      if (left < 0) {
        state = 'closed'
        el.dataset.state = state
        const tape = el.querySelector<HTMLElement>('.tape')
        if (tape) {
          tape.dataset.state = state
          tape.textContent = 'Closed'
        }
        leftEl?.remove()
      } else if (leftEl) {
        leftEl.textContent = left === 0 ? 'Closes today' : left === 1 ? '1 day left' : `${left} days left`
        leftEl.toggleAttribute('data-soon', left < 7)
      }
    }
    const split = (s?: string) => (s ? s.split(' ') : [])
    return [
      {
        el,
        state,
        deadline,
        opens: d.opens ?? '',
        checked,
        sets: {
          status: [state],
          access: [d.access ?? ''],
          applicant: split(d.applicant),
          approach: split(d.approach),
          size: split(d.size),
        },
        where: split(d.where),
        text: d.text ?? '',
      },
    ]
  })

  const order: Record<string, number> = { open: 0, rolling: 1, upcoming: 2, none: 3, closed: 4 }
  const key = (i: Item) => (i.state === 'upcoming' ? i.opens || i.deadline || '9999' : i.deadline || '9999')
  items.sort((a, b) => {
    const s = order[a.state] - order[b.state]
    if (s) return s
    return key(a).localeCompare(key(b)) * (a.state === 'closed' ? -1 : 1)
  })
  list.append(...items.filter((i) => !isLater(i.state)).map((i) => i.el))
  laterList.append(...items.filter((i) => isLater(i.state)).map((i) => i.el))

  function read(): Filters {
    const fd = new FormData(form!)
    const f = {
      q: String(fd.get('q') ?? '').trim(),
      within: String(fd.get('within') ?? ''),
      where: String(fd.get('where') ?? ''),
    } as Filters
    for (const m of MULTI) f[m] = fd.getAll(m).map(String)
    return f
  }

  function write(f: Filters) {
    form!.querySelector<HTMLInputElement>('[name="q"]')!.value = f.q
    whereSelect.value = f.where
    for (const input of form!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      input.checked = (f[input.name as Multi] ?? []).includes(input.value)
    }
    for (const input of form!.querySelectorAll<HTMLInputElement>('input[name="within"]')) {
      input.checked = input.value === f.within
    }
  }

  function fromUrl(): Filters {
    const sp = new URLSearchParams(location.search)
    const f = { q: sp.get('q') ?? '', within: sp.get('within') ?? '', where: sp.get('where') ?? '' } as Filters
    for (const m of MULTI) f[m] = (sp.get(m) ?? '').split(',').filter(Boolean)
    if (f.where && ![...whereSelect.options].some((o) => o.value === f.where)) f.where = ''
    return f
  }

  function toUrl(f: Filters) {
    const sp = new URLSearchParams()
    if (f.q) sp.set('q', f.q)
    for (const m of MULTI) if (f[m].length) sp.set(m, f[m].join(','))
    if (f.within) sp.set('within', f.within)
    if (f.where) sp.set('where', f.where)
    const qs = sp.toString().replaceAll('%2C', ',')
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname)
  }

  function whereMatches(i: Item, where: string) {
    if (!where) return true
    if (i.where.includes('*')) return true
    if (where.startsWith('r:')) {
      const r = where.slice(2)
      return i.where.includes(`r:${r}`) || i.where.includes(`R:${r}`)
    }
    const region = whereSelect.selectedOptions[0]?.dataset.region
    return i.where.includes(where) || (!!region && i.where.includes(`R:${region}`))
  }

  function matches(i: Item, f: Filters, skip?: Multi) {
    if (f.q && !f.q.toLowerCase().split(/\s+/).every((w) => i.text.includes(w))) return false
    for (const m of MULTI) {
      if (m === skip || !f[m].length) continue
      if (!f[m].some((v) => i.sets[m].includes(v))) return false
    }
    if (f.within) {
      if (!i.deadline || !(i.state === 'open' || i.state === 'upcoming')) return false
      const left = days(today, i.deadline)
      if (left < 0 || left > Number(f.within)) return false
    }
    return whereMatches(i, f.where)
  }

  function labelFor(name: string, value: string) {
    if (name === 'where') return whereSelect.selectedOptions[0]?.textContent ?? value
    if (name === 'q') return `“${value}”`
    const input = form!.querySelector<HTMLInputElement>(`input[name="${name}"][value="${CSS.escape(value)}"]`)
    return input?.closest('label')?.querySelector('.check__text')?.textContent?.trim() ?? value
  }

  function chips(f: Filters) {
    const active: [string, string][] = []
    if (f.q) active.push(['q', f.q])
    for (const m of MULTI) for (const v of f[m]) active.push([m, v])
    if (f.within) active.push(['within', f.within])
    if (f.where) active.push(['where', f.where])
    chipsEl.replaceChildren(
      ...active.map(([name, value]) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'chip'
        b.dataset.name = name
        b.dataset.value = value
        b.setAttribute('aria-label', `Remove filter: ${labelFor(name, value)}`)
        b.innerHTML = `<span></span><span class="chip__x" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>`
        b.firstElementChild!.textContent = labelFor(name, value)
        return b
      }),
    )
    if (active.length > 1) {
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'chip chip--clear'
      clear.dataset.reset = ''
      clear.textContent = 'Clear all'
      chipsEl.append(clear)
    }
    chipsEl.hidden = active.length === 0
    // The badge sits on Filters, so it leaves out the search box above it.
    const filters = active.filter(([name]) => name !== 'q').length
    badge.hidden = filters === 0
    badge.textContent = String(filters)
  }

  function apply() {
    const f = read()
    let shown = 0
    let shownLater = 0
    for (const i of items) {
      const ok = matches(i, f)
      i.el.hidden = !ok
      if (ok) shown++
      if (ok && isLater(i.state)) shownLater++
    }
    laterCount.textContent = String(shownLater)
    later.hidden = shownLater === 0
    if (shownLater > 0 && (shown === shownLater || f.status.some(isLater))) later.open = true
    for (const n of form!.querySelectorAll<HTMLElement>('[data-n]')) {
      const [group, value] = n.dataset.n!.split(':') as [Multi, string]
      const count = items.filter((i) => i.sets[group].includes(value) && matches(i, f, group)).length
      n.textContent = String(count)
      const input = n.closest('label')?.querySelector('input')
      if (input) input.disabled = count === 0 && !input.checked
    }
    countEl.textContent =
      shown === items.length
        ? `${items.length} programmes`
        : `${shown} of ${items.length} programme${items.length === 1 ? '' : 's'}`
    emptyEl.hidden = shown > 0
    done.textContent = shown === 1 ? 'Show 1 result' : `Show ${shown} results`
    chips(f)
    toUrl(f)
  }

  function reset() {
    form!.reset()
    apply()
  }

  write(fromUrl())
  apply()
  form.addEventListener('input', apply)
  form.addEventListener('submit', (e) => e.preventDefault())
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-reset], .chip')
    if (!t) return
    if ('reset' in t.dataset) return reset()
    const { name, value } = t.dataset
    const f = read()
    if (name === 'q' || name === 'within' || name === 'where') f[name] = ''
    else if (name) f[name as Multi] = f[name as Multi].filter((v) => v !== value)
    write(f)
    apply()
  })
}
