// The table finder. Filters, sorts and quick filters run over the server-rendered rows,
// and every setting lives in the URL.

const AGING_DAYS = 30
const HIDDEN_DAYS = 90
const MULTI = ['status', 'access', 'applicant', 'approach', 'size'] as const
type Multi = (typeof MULTI)[number]
type SortKey = 'deadline' | 'amount' | 'checked'

type Item = {
  el: HTMLTableRowElement
  state: string
  deadline: string
  opens: string
  checked: string
  usd: number | null
  name: string
  sets: Record<Multi, string[]>
  where: string[]
  text: string
}

type Filters = { q: string; within: string; where: string } & Record<Multi, string[]>

const today = new Date().toISOString().slice(0, 10)
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
const isLater = (state: string) => state === 'none' || state === 'closed'
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${months[m! - 1]} ${y}`
}
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// Each sort's natural direction: soonest deadline, largest amount, most recently checked.
const naturalDir: Record<SortKey, 'ascending' | 'descending'> = {
  deadline: 'ascending',
  amount: 'descending',
  checked: 'descending',
}

export function initTableFinder() {
  const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!
  const form = $<HTMLFormElement>('[data-form]')
  const list = $<HTMLTableSectionElement>('[data-list]')
  if (!form || !list) return
  const laterList = $<HTMLTableSectionElement>('[data-list-later]')
  const laterHead = $<HTMLTableSectionElement>('[data-later-head]')
  const laterToggle = $<HTMLButtonElement>('[data-later-toggle]')
  const laterVerb = $<HTMLElement>('[data-later-verb]')
  const laterSep = $<HTMLElement>('[data-later-sep]')
  const tableWrap = $<HTMLElement>('[data-table]')
  const endfold = $<HTMLButtonElement>('[data-endfold]')
  const endN = $<HTMLElement>('[data-qn-end]')
  const sortLine = $<HTMLElement>('[data-sort-line]')
  const live = $<HTMLElement>('[data-live]')
  const shownEl = $<HTMLElement>('[data-shown]')
  const emptyEl = $<HTMLElement>('[data-empty]')
  const emptyText = $<HTMLElement>('[data-empty-text]')
  const emptyHead = $<HTMLElement>('[data-empty-head]')
  const chipsEl = $<HTMLElement>('[data-chips]')
  const badge = $<HTMLElement>('[data-filter-count]')
  const whereSelect = form.querySelector<HTMLSelectElement>('select[name="where"]')!
  const sortSelect = $<HTMLSelectElement>('[data-sort-select]')
  const sheet = $<HTMLElement>('[data-sheet]')
  const backdrop = $<HTMLElement>('[data-backdrop]')
  const opener = $<HTMLButtonElement>('[data-sheet-open]')
  const done = $<HTMLButtonElement>('[data-sheet-done]')

  let showLater = false
  let sort: SortKey = 'deadline'
  let reversed = false

  // ---------- Rows: freshness, days left, and calls that closed since the build ----------
  const rows = [...list.rows, ...laterList.rows] as HTMLTableRowElement[]
  const items = rows.flatMap((el): Item[] => {
    const d = el.dataset
    const checked = d.checked ?? ''
    const age = days(checked, today)
    if (age > HIDDEN_DAYS) {
      el.remove()
      return []
    }
    if (age > AGING_DAYS) for (const st of el.querySelectorAll('.stamp')) st.setAttribute('data-aging', '')
    let state = d.state ?? ''
    const deadline = d.deadline ?? ''
    if (state === 'open' && deadline) {
      const left = days(today, deadline)
      const leftEl = el.querySelector<HTMLElement>('[data-left]')
      if (left < 0) {
        state = 'closed'
        el.dataset.state = state
        const dl = el.querySelector<HTMLElement>('.dl')
        if (dl) dl.innerHTML = `<span class="status" data-state="closed">Closed</span><span class="dl__muted">${shortDate(deadline)}</span>`
        el.querySelector('[data-words]')?.remove()
      } else if (leftEl) {
        leftEl.textContent = left === 0 ? 'Closes today' : left === 1 ? '1 day left' : `${left} days left`
        leftEl.toggleAttribute('data-soon', left <= 7)
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
        usd: d.usd ? Number(d.usd) : null,
        name: d.name ?? '',
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

  // ---------- Sorting ----------
  const order: Record<string, number> = { open: 0, rolling: 1, upcoming: 2, none: 3, closed: 4 }
  const dkey = (i: Item) => (i.state === 'upcoming' ? i.opens || i.deadline || '9999' : i.deadline || '9999')
  const byDeadline = (a: Item, b: Item) => {
    const s = order[a.state]! - order[b.state]!
    if (s) return s
    return dkey(a).localeCompare(dkey(b)) * (a.state === 'closed' ? -1 : 1) || a.name.localeCompare(b.name)
  }
  const compare: Record<SortKey, (a: Item, b: Item) => number> = {
    deadline: byDeadline,
    amount: (a, b) => (b.usd ?? -1) - (a.usd ?? -1),
    checked: (a, b) => b.checked.localeCompare(a.checked),
  }

  function applySort() {
    const sign = reversed ? -1 : 1
    const cmp = (a: Item, b: Item) => {
      // Rows without an amount stay at the bottom either way.
      if (sort === 'amount' && (a.usd === null) !== (b.usd === null)) return a.usd === null ? 1 : -1
      return compare[sort](a, b) * sign || byDeadline(a, b)
    }
    const s = [...items].sort(cmp)
    list.append(...s.filter((i) => !isLater(i.state)).map((i) => i.el))
    laterList.append(...s.filter((i) => isLater(i.state)).map((i) => i.el))
    for (const th of document.querySelectorAll<HTMLElement>('th[data-col]')) {
      if (th.dataset.col !== sort) {
        th.removeAttribute('aria-sort')
        continue
      }
      const nat = naturalDir[sort]
      th.setAttribute('aria-sort', reversed ? (nat === 'ascending' ? 'descending' : 'ascending') : nat)
    }
    // The mid-width table folds Checked into the Amount header; its button shows the same state.
    for (const b of document.querySelectorAll<HTMLElement>('[data-alt-for]')) {
      const nat = naturalDir.checked
      if (sort === 'checked') b.dataset.active = reversed ? (nat === 'ascending' ? 'descending' : 'ascending') : nat
      else delete b.dataset.active
    }
    const lines: Record<SortKey, [string, string]> = {
      deadline: ['Open calls first, soonest deadline first', 'Open calls first, latest deadline first'],
      amount: ['Largest amount first', 'Smallest amount first'],
      checked: ['Most recently checked first', 'Least recently checked first'],
    }
    sortLine.textContent = lines[sort][reversed ? 1 : 0]
    sortSelect.value = sort
  }

  // ---------- Filters ----------
  function read(): Filters {
    const fd = new FormData(form)
    const f = {
      q: String(fd.get('q') ?? '').trim(),
      within: String(fd.get('within') ?? ''),
      where: String(fd.get('where') ?? ''),
    } as Filters
    for (const m of MULTI) f[m] = fd.getAll(m).map(String)
    return f
  }

  function write(f: Filters) {
    form.querySelector<HTMLInputElement>('[name="q"]')!.value = f.q
    whereSelect.value = f.where
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      input.checked = (f[input.name as Multi] ?? []).includes(input.value)
    }
    for (const input of form.querySelectorAll<HTMLInputElement>('input[name="within"]')) {
      input.checked = input.value === f.within
    }
  }

  function fromUrl(): Filters {
    const sp = new URLSearchParams(location.search)
    const f = { q: sp.get('q') ?? '', within: sp.get('within') ?? '', where: sp.get('where') ?? '' } as Filters
    for (const m of MULTI) f[m] = (sp.get(m) ?? '').split(',').filter(Boolean)
    if (f.where && ![...whereSelect.options].some((o) => o.value === f.where)) f.where = ''
    if (!['', '7', '30', '90'].includes(f.within)) f.within = ''
    const s = (sp.get('sort') ?? '').replace(/^-/, '')
    if (s === 'amount' || s === 'checked' || s === 'deadline') {
      sort = s
      reversed = (sp.get('sort') ?? '').startsWith('-')
    }
    showLater = sp.get('later') === '1'
    return f
  }

  function toUrl(f: Filters) {
    const sp = new URLSearchParams()
    if (f.q) sp.set('q', f.q)
    for (const m of MULTI) if (f[m].length) sp.set(m, f[m].join(','))
    if (f.within) sp.set('within', f.within)
    if (f.where) sp.set('where', f.where)
    if (sort !== 'deadline' || reversed) sp.set('sort', `${reversed ? '-' : ''}${sort}`)
    if (showLater) sp.set('later', '1')
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

  function matches(i: Item, f: Filters, skip?: Multi | 'within') {
    if (f.q && !f.q.toLowerCase().split(/\s+/).every((w) => i.text.includes(w))) return false
    for (const m of MULTI) {
      if (m === skip || !f[m].length) continue
      if (!f[m].some((v) => i.sets[m].includes(v))) return false
    }
    if (f.within && skip !== 'within') {
      if (!i.deadline || !(i.state === 'open' || i.state === 'upcoming')) return false
      const left = days(today, i.deadline)
      if (left < 0 || left > Number(f.within)) return false
    }
    return whereMatches(i, f.where)
  }

  function labelFor(name: string, value: string) {
    if (name === 'where') return whereSelect.selectedOptions[0]?.textContent ?? value
    if (name === 'q') return `“${value}”`
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${CSS.escape(value)}"]`)
    return input?.closest('label')?.querySelector('.opt__text')?.textContent?.trim() ?? value
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
    const filters = active.filter(([name]) => name !== 'q').length
    badge.hidden = filters === 0
    badge.textContent = String(filters)
    for (const g of form.querySelectorAll<HTMLElement>('[data-gcount]')) {
      const key = g.dataset.gcount!
      const n = key === 'within' || key === 'where' ? (f[key] ? 1 : 0) : f[key as Multi].length
      g.hidden = n === 0
      g.textContent = String(n)
    }
  }

  function setQuick(key: string, n: number, one: string, many: string) {
    const b = document.querySelector<HTMLElement>(`[data-qn="${key}"]`)
    if (b) b.textContent = String(n)
    const l = document.querySelector<HTMLElement>(`[data-ql="${key}"]`)
    if (l) l.textContent = plural(n, one, many)
  }

  // The next seven days and after, drawn between rows while the table is sorted by soonest deadline.
  const weekOut = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10)
  function dividerRow(kind: 'soon' | 'later', text: string) {
    const tr = document.createElement('tr')
    tr.className = `divider divider--${kind}`
    tr.setAttribute('aria-hidden', 'true')
    const td = document.createElement('td')
    td.colSpan = 4
    td.textContent = text
    tr.append(td)
    return tr
  }
  function dividers() {
    for (const d of list.querySelectorAll('.divider')) d.remove()
    if (sort !== 'deadline' || reversed) return
    const byEl = new Map(items.map((i) => [i.el as Element, i]))
    const visible = [...list.rows].flatMap((r) => {
      const i = byEl.get(r)
      return i && !r.hidden ? [i] : []
    })
    const firstOpen = visible.find((i) => i.state === 'open' && i.deadline)
    if (!firstOpen) return
    const after = visible.find((i) => i.state === 'open' && i.deadline && i.deadline > weekOut)
    const inside = visible.some((i) => i.state === 'open' && i.deadline && i.deadline <= weekOut)
    list.insertBefore(
      inside ? dividerRow('soon', `Closing in the next 7 days, by ${shortDate(weekOut)}`) : dividerRow('later', `Closing after ${shortDate(weekOut)}`),
      firstOpen.el,
    )
    // Only when some open calls close inside the week and some after it.
    if (after && inside) list.insertBefore(dividerRow('later', `Closing after ${shortDate(weekOut)}`), after.el)
  }

  function apply() {
    const f = read()
    let shownNow = 0
    let shownLater = 0
    // Asked-for not-open rows ignore a status filter that names only open states ("Open now" plus "Show not open").
    const laterSkip = showLater && !f.status.some(isLater) ? 'status' : undefined
    for (const i of items) {
      const ok = isLater(i.state) ? matches(i, f, laterSkip) : matches(i, f)
      i.el.hidden = !ok
      if (!ok) continue
      if (isLater(i.state)) shownLater++
      else shownNow++
    }
    // Not-open rows show when asked for, when the status filter names them, or when they are all that matches.
    const forced = f.status.some(isLater) || (shownNow === 0 && shownLater > 0)
    const laterOn = showLater || forced
    laterHead.hidden = !laterOn || shownLater === 0
    laterList.hidden = !laterOn
    const shown = shownNow + (laterOn ? shownLater : 0)
    dividers()

    // The summary sentence counts what the other filters leave, so each part says what a click gives.
    const base = items.filter((i) => matches(i, f, 'status'))
    const byState = (s: string) => base.filter((i) => i.state === s).length
    const soon = items.filter((i) => matches(i, { ...f, within: '7' }, 'status') && i.state === 'open').length
    const laterN = items.filter((i) => isLater(i.state) && matches(i, f, 'status')).length
    setQuick('open', byState('open'), 'Open now', 'Open now')
    setQuick('soon', soon, 'closing within 7 days', 'closing within 7 days')
    setQuick('rolling', byState('rolling'), '', '')
    setQuick('upcoming', byState('upcoming'), '', '')
    setQuick('later', laterN, '', '')
    endN.textContent = String(laterN)
    endfold.hidden = laterOn || laterN === 0
    for (const q of document.querySelectorAll<HTMLButtonElement>('[data-quick]')) {
      const [name, value] = q.dataset.quick!.split(':') as [string, string]
      const on = name === 'within' ? f.within === value : f[name as Multi].includes(value)
      q.setAttribute('aria-pressed', String(on))
      q.disabled = !on && q.querySelector('b')?.textContent === '0'
    }
    laterToggle.setAttribute('aria-pressed', String(laterOn))
    laterToggle.disabled = forced || laterN === 0
    laterToggle.hidden = laterN === 0
    laterSep.hidden = laterN === 0
    laterVerb.textContent = laterOn ? 'Hide' : 'Show'

    for (const n of form.querySelectorAll<HTMLElement>('[data-n]')) {
      const [group, value] = n.dataset.n!.split(':') as [Multi, string]
      const count = items.filter((i) => i.sets[group].includes(value) && matches(i, f, group)).length
      n.textContent = String(count)
      const input = n.closest('label')?.querySelector('input')
      if (input) input.disabled = count === 0 && !input.checked
    }

    shownEl.textContent = `${shown} of ${items.length} shown`
    live.textContent = `${shown} ${plural(shown, 'programme', 'programmes')} shown`
    // Nothing to show: no header, no end card, just the message where the rows would be.
    emptyEl.hidden = shown > 0
    tableWrap.hidden = shown === 0
    if (shown === 0) endfold.hidden = true
    // laterN counts not-open rows the other filters match, which the status filter may be hiding.
    emptyHead.textContent = laterN === 0 ? 'Nothing matches.' : 'Nothing open matches.'
    if (shown === 0) {
      emptyText.innerHTML =
        laterN > 0
          ? `${laterN} not open now ${plural(laterN, 'matches', 'match')}. <button type="button" class="linkish" data-later-show>Show ${plural(laterN, 'it', 'them')}</button>, or <button type="button" class="linkish" data-reset>clear all filters</button>.`
          : `Try another search, remove a filter, or <button type="button" class="linkish" data-reset>clear all</button>.`
    }
    done.textContent = `Show ${shown} ${plural(shown, 'result', 'results')}`
    chips(f)
    toUrl(f)
  }

  function reset() {
    form.reset()
    apply()
  }

  // ---------- Filter sheet (phones and tablets) ----------
  const narrow = matchMedia('(max-width: 67.99rem)')
  const focusables = () =>
    [...sheet.querySelectorAll<HTMLElement>('button, input, select, [tabindex]')].filter(
      (e) => !(e as HTMLInputElement).disabled && e.offsetParent !== null,
    )
  function openSheet() {
    sheet.dataset.open = ''
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    backdrop.hidden = false
    opener.setAttribute('aria-expanded', 'true')
    document.documentElement.style.overflow = 'hidden'
    sheet.querySelector<HTMLElement>('[data-sheet-close]')?.focus()
  }
  function closeSheet(scroll = false) {
    if (!('open' in sheet.dataset)) return
    delete sheet.dataset.open
    sheet.removeAttribute('role')
    sheet.removeAttribute('aria-modal')
    backdrop.hidden = true
    opener.setAttribute('aria-expanded', 'false')
    document.documentElement.style.overflow = ''
    if (scroll) document.querySelector('.results')?.scrollIntoView({ block: 'start' })
    opener.focus({ preventScroll: scroll })
  }
  opener.addEventListener('click', openSheet)
  backdrop.addEventListener('click', () => closeSheet())
  sheet.querySelector('[data-sheet-close]')!.addEventListener('click', () => closeSheet())
  done.addEventListener('click', () => closeSheet(true))
  narrow.addEventListener('change', () => closeSheet())
  sheet.addEventListener('keydown', (e) => {
    if (!('open' in sheet.dataset)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSheet()
    }
    if (e.key === 'Tab') {
      const f = focusables()
      const first = f[0]
      const last = f.at(-1)
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
  })

  // ---------- Wiring ----------
  const f0 = fromUrl()
  write(f0)
  applySort()
  apply()

  form.addEventListener('input', apply)
  form.addEventListener('submit', (e) => e.preventDefault())

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
    b.addEventListener('click', () => {
      const k = b.dataset.sort as SortKey
      if (k === sort) reversed = !reversed
      else {
        sort = k
        reversed = false
      }
      applySort()
      apply()
    })
  }
  sortSelect.addEventListener('change', () => {
    sort = sortSelect.value as SortKey
    reversed = false
    applySort()
    apply()
  })

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const quick = t.closest<HTMLButtonElement>('[data-quick]')
    if (quick) {
      const [name, value] = quick.dataset.quick!.split(':') as [string, string]
      const f = read()
      if (name === 'within') f.within = f.within === value ? '' : value
      else {
        const m = name as Multi
        f[m] = f[m].includes(value) ? f[m].filter((v) => v !== value) : [...f[m], value]
      }
      write(f)
      apply()
      return
    }
    if (t.closest('[data-later-toggle]')) {
      showLater = !showLater
      apply()
      if (showLater) laterHead.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    if (t.closest('[data-later-hide]')) {
      showLater = false
      apply()
      laterToggle.focus()
      return
    }
    if (t.closest('[data-later-show]')) {
      showLater = true
      apply()
      return
    }
    const c = t.closest<HTMLElement>('[data-reset], .chip')
    if (!c) return
    if ('reset' in c.dataset) return reset()
    const { name, value } = c.dataset
    const f = read()
    if (name === 'q' || name === 'within' || name === 'where') f[name] = ''
    else if (name) f[name as Multi] = f[name as Multi].filter((v) => v !== value)
    write(f)
    apply()
  })
}
