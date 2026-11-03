// The table finder. Filters, sorts and quick filters run over the server-rendered rows,
// and every setting lives in the URL: Where and the project type in the path when a page holds that pair
// (src/lib/finder-pages.ts), the rest in the address.
import { pageHref, type PagePaths } from './page-paths'
import { picker } from './picker'

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
  /** The deadline cell for each call group, when the programme's calls differ by country; the first is the built one. */
  cells: Cell[]
  cell: Cell | null
}

/** One version of a row's deadline cell: `codes` are the countries it is for, `*` the rest, empty the built cell. */
type Cell = { codes: string[]; state: string; deadline: string; opens: string; html: string }

type Filters = { q: string; within: string; where: string } & Record<Multi, string[]>

const today = new Date().toISOString().slice(0, 10)
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
const isLater = (state: string) => state === 'none' || state === 'closed'
// Same as src/lib/format.ts shortDate: Nov 1, 2026.
const shortFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const shortDate = (iso: string) => shortFmt.format(new Date(`${iso}T00:00:00Z`))
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
  const tableWrap = $<HTMLElement>('[data-table]')
  const endfold = $<HTMLButtonElement>('[data-endfold]')
  const sortLine = $<HTMLElement>('[data-sort-line]')
  const live = $<HTMLElement>('[data-live]')
  // How many show and Clear all sit in the sidebar on wide screens and above the table on narrower ones.
  const shownEls = [...document.querySelectorAll<HTMLElement>('[data-shown]')]
  const emptyEl = $<HTMLElement>('[data-empty]')
  const emptyText = $<HTMLElement>('[data-empty-text]')
  const emptyHead = $<HTMLElement>('[data-empty-head]')
  const clearEls = [...document.querySelectorAll<HTMLElement>('[data-clear]')]
  const badge = $<HTMLElement>('[data-filter-count]')
  const sortSelect = $<HTMLSelectElement>('[data-sort-select]')
  const sheet = $<HTMLElement>('[data-sheet]')
  const backdrop = $<HTMLElement>('[data-backdrop]')
  const opener = $<HTMLButtonElement>('[data-sheet-open]')
  const done = $<HTMLButtonElement>('[data-sheet-done]')
  // The header card owns where, when and who (its selects) and the approach (its project types); the sidebar
  // owns status, how to apply and size. Each filter has that one control.
  const ask = $<HTMLFormElement>('[data-ask]')
  const askSelects = [...ask.querySelectorAll('select')]
  for (const s of askSelects) picker(s, s.name === 'where')
  // The weekly email form's Where gets the same flags; its own pages under /digest/ load no script.
  for (const s of document.querySelectorAll<HTMLSelectElement>('select[data-flags]'))
    picker(s, true, 'top-1/2 left-[0.65rem] -translate-y-1/2', 'pl-[2.4rem]!')
  const askSelect = (name: string) => ask.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!
  const whereSelect = askSelect('where')
  const cats = [...document.querySelectorAll<HTMLElement>('[data-cat]')]
  // The page's own Where and project type, and the page for every other pair.
  const presetWhere = ask.dataset.presetWhere ?? ''
  const presetCat = ask.dataset.presetCat ?? ''
  const pages: PagePaths = JSON.parse(ask.dataset.pages ?? '{}')
  const catOf = (a: string[]) => [...a].sort().join(' ')
  let approach: string[] = []

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
    const deadline = d.deadline ?? ''
    const split = (s?: string) => (s ? s.split(' ') : [])
    const alts = [...el.querySelectorAll<HTMLTemplateElement>('template[data-where-dl]')].map((t) => ({
      codes: split(t.dataset.whereDl),
      state: t.dataset.state ?? '',
      deadline: t.dataset.deadline ?? '',
      opens: t.dataset.opens ?? '',
      html: t.innerHTML,
    }))
    const built = { codes: [], state: d.state ?? '', deadline, opens: d.opens ?? '', html: el.querySelector('.dl')?.innerHTML ?? '' }
    const state = freshen(el, built.state, deadline)
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
        cells: alts.length ? [built, ...alts] : [],
        cell: alts.length ? built : null,
      },
    ]
  })

  /** Days left on an open call, or Closed once its deadline has passed since the build. Returns the state it shows. */
  function freshen(el: HTMLElement, state: string, deadline: string) {
    if (state !== 'open' || !deadline) return state
    const left = days(today, deadline)
    const leftEl = el.querySelector<HTMLElement>('[data-left]')
    if (left < 0) {
      el.dataset.state = 'closed'
      const dl = el.querySelector<HTMLElement>('.dl')
      if (dl)
        dl.innerHTML = `<span class="dl__when dl__when--muted">${shortDate(deadline)}</span><span class="dl__meta"><span class="status" data-state="closed">Closed</span></span>`
      return 'closed'
    }
    if (leftEl) {
      leftEl.textContent = left === 0 ? 'Closes today' : left === 1 ? '1 day left' : `${left} days left`
      leftEl.toggleAttribute('data-soon', left <= 7)
    }
    return state
  }

  /** Rows whose calls differ by country show the call for the Where's country. True when any row changed. */
  function localize(where: string) {
    const country = where && !where.startsWith('r:') ? where : ''
    let changed = false
    for (const i of items) {
      if (!i.cell) continue
      const alts = i.cells.slice(1)
      const cell = (country && (alts.find((c) => c.codes.includes(country)) ?? alts.find((c) => c.codes[0] === '*'))) || i.cells[0]!
      if (cell === i.cell) continue
      i.cell = cell
      const dl = i.el.querySelector<HTMLElement>('.dl')
      if (dl) dl.innerHTML = cell.html
      i.el.dataset.state = cell.state
      i.state = freshen(i.el, cell.state, cell.deadline)
      i.deadline = cell.deadline
      i.opens = cell.opens
      i.sets.status = [i.state]
      changed = true
    }
    return changed
  }

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
    // Checked sorts from a second button in the Amount header, whose column has no aria-sort for it.
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
    const applicant = askSelect('applicant').value
    return {
      q: String(fd.get('q') ?? '').trim(),
      within: askSelect('within').value,
      where: whereSelect.value,
      approach: [...approach],
      applicant: applicant ? [applicant] : [],
      status: fd.getAll('status').map(String),
      access: fd.getAll('access').map(String),
      size: fd.getAll('size').map(String),
    }
  }

  function write(f: Filters) {
    form.querySelector<HTMLInputElement>('[name="q"]')!.value = f.q
    whereSelect.value = f.where
    askSelect('within').value = f.within
    askSelect('applicant').value = f.applicant[0] ?? ''
    approach = f.approach
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      input.checked = (f[input.name as Multi] ?? []).includes(input.value)
    }
    for (const s of askSelects) s.dispatchEvent(new Event('sync'))
  }

  function fromUrl(): Filters {
    const sp = new URLSearchParams(location.search)
    const f = { q: sp.get('q') ?? '', within: sp.get('within') ?? '', where: sp.get('where') ?? presetWhere } as Filters
    for (const m of MULTI) f[m] = (sp.get(m) ?? '').split(',').filter(Boolean)
    if (!sp.has('approach') && presetCat) f.approach = presetCat.split(' ')
    // Who can apply is one select, so an address can pick one.
    f.applicant = f.applicant.filter((a) => [...askSelect('applicant').options].some((o) => o.value === a)).slice(0, 1)
    if (f.where && ![...whereSelect.options].some((o) => o.value === f.where)) f.where = ''
    if (!['', '7', '30', '90'].includes(f.within)) f.within = ''
    // Approach comes only from the type tabs, so an older address naming other approaches (one, or a mix)
    // widens to the tab that holds them all, or drops them when no tab does.
    const tab = cats.find((c) => c.dataset.cat && f.approach.every((a) => c.dataset.cat!.split(' ').includes(a)))
    f.approach = f.approach.length && tab ? tab.dataset.cat!.split(' ') : []
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
    for (const m of MULTI) if (f[m].length && !(m === 'approach' && catOf(f.approach) === presetCat)) sp.set(m, f[m].join(','))
    if (f.within) sp.set('within', f.within)
    if (f.where && f.where !== presetWhere) sp.set('where', f.where)
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

  // The Filters button counts the sidebar's filters; "Clear all filters" shows once any filter is on.
  function counts(f: Filters) {
    const sideN = f.status.length + f.access.length + f.size.length
    badge.hidden = sideN === 0
    badge.textContent = String(sideN)
    const any = !!(
      f.q ||
      f.within ||
      f.where !== presetWhere ||
      catOf(f.approach) !== presetCat ||
      MULTI.some((m) => m !== 'approach' && f[m].length)
    )
    for (const c of clearEls) c.hidden = !any
    for (const g of form.querySelectorAll<HTMLElement>('[data-gcount]')) {
      const n = f[g.dataset.gcount as Multi].length
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

  function apply() {
    const f = read()
    if (localize(f.where)) applySort()
    // The programme page reads the Where, so the place carries through.
    for (const i of items) {
      const a = i.el.querySelector<HTMLAnchorElement>('a.name')
      if (a) a.search = f.where ? `?where=${encodeURIComponent(f.where)}` : ''
    }
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

    // The summary sentence counts what the other filters leave, so each part says what a click gives.
    const base = items.filter((i) => matches(i, f, 'status'))
    const byState = (s: string) => base.filter((i) => i.state === s).length
    const laterN = items.filter((i) => isLater(i.state) && matches(i, f, 'status')).length
    setQuick('open', byState('open'), 'Open now', 'Open now')
    setQuick('rolling', byState('rolling'), '', '')
    setQuick('upcoming', byState('upcoming'), '', '')
    setQuick('later', laterN, '', '')
    endfold.hidden = laterOn || laterN === 0
    for (const q of document.querySelectorAll<HTMLButtonElement>('[data-quick]')) {
      const on = f.status.includes(q.dataset.quick!.split(':')[1]!)
      q.setAttribute('aria-pressed', String(on))
      q.disabled = !on && q.querySelector('b')?.textContent === '0'
    }

    for (const n of form.querySelectorAll<HTMLElement>('[data-n]')) {
      const [group, value] = n.dataset.n!.split(':') as [Multi, string]
      const count = items.filter((i) => i.sets[group].includes(value) && matches(i, f, group)).length
      n.textContent = String(count)
      const input = n.closest('label')?.querySelector('input')
      if (input) input.disabled = count === 0 && !input.checked
    }
    const appr = [...f.approach].sort().join(' ')
    for (const c of cats) c.setAttribute('aria-current', String(c.dataset.cat === appr))

    for (const s of shownEls) s.textContent = `${shown} of ${items.length} shown`
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
          ? `${laterN} not open now ${plural(laterN, 'matches', 'match')}${f.status.length ? ' your other filters' : ''}. <button type="button" class="linkish" data-later-show>Show ${plural(laterN, 'it', 'them')}</button>, or <button type="button" class="linkish" data-reset>clear all filters</button>.`
          : `Try another search, remove a filter, or <button type="button" class="linkish" data-reset>clear all</button>.`
    }
    done.textContent = `Show ${shown} ${plural(shown, 'result', 'results')}`
    counts(f)
    toUrl(f)
    // Each tab's link carries the current place and filters, so a new-tab open keeps them as a click does.
    for (const c of cats) if (c instanceof HTMLAnchorElement) c.href = pageHref(pages, f.where, c.dataset.cat ?? '', new URLSearchParams(location.search))
  }

  function reset() {
    write({ q: '', within: '', where: presetWhere, status: [], approach: presetCat ? presetCat.split(' ') : [], applicant: [], access: [], size: [] })
    apply()
  }

  /** Goes to the page for the chosen Where and project type when it isn't this one; true when it left. */
  function navigate() {
    const href = pageHref(pages, whereSelect.value, catOf(approach), new URLSearchParams(location.search))
    if (new URL(href, location.href).pathname === location.pathname) return false
    location.assign(href)
    return true
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
  // An address naming another page's place or type, e.g. /?where=KE from before the place pages.
  if (navigate()) return
  applySort()
  apply()

  // Back from another page can restore this one from the cache with the controls as they were left: read the address again.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return
    write(fromUrl())
    applySort()
    apply()
  })
  form.addEventListener('input', apply)
  form.addEventListener('submit', (e) => e.preventDefault())
  ask.addEventListener('change', () => navigate() || apply())
  ask.addEventListener('submit', (e) => {
    e.preventDefault()
    document.querySelector('.results')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })

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
    const cat = t.closest<HTMLElement>('[data-cat]')
    if (cat && !((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey)) {
      e.preventDefault()
      approach = cat.dataset.cat ? cat.dataset.cat.split(' ') : []
      if (!navigate()) apply()
      return
    }
    const quick = t.closest<HTMLButtonElement>('[data-quick]')
    if (quick) {
      const value = quick.dataset.quick!.split(':')[1]!
      const f = read()
      f.status = f.status.includes(value) ? f.status.filter((v) => v !== value) : [...f.status, value]
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
      endfold.focus()
      return
    }
    if (t.closest('[data-later-show]')) {
      showLater = true
      apply()
      return
    }
    if (t.closest('[data-reset]')) reset()
  })
}
